/* =========================================================
   ECOWAST — DASHBOARD INTERACTION
   Firebase sensor dashboard. Pump controls remain simulated.
========================================================= */

"use strict";

const $ = (id) => document.getElementById(id);

const elements = {
    ph: $("ph"),
    turbidity: $("turbidity"),
    moisture: $("moisture"),
    tank1: $("tank1Input"),
    tank2: $("tank2Input"),
    pump1: $("pump1"),
    pump2: $("pump2"),
    pump3: $("pump3"),
    pump4: $("pump4"),
    uv: $("uvButton")
};

const state = {
    firebaseLive: false,
    firebaseDataLoaded: false,
    reservoirFull: false,
    reservoirReadingAvailable: false,
    phIsRawAdc: false,
    turbidityIsRawAdc: false,
    pumps: {
        pump1: false,
        pump2: false,
        pump3: false,
        pump4: false,
        uv: false
    }
};

const sensorHistory = {
    ph: [],
    turbidity: [],
    moisture: [],
    tank1: [],
    tank2: [],
    temperature: [],
    humidity: []
};

const chartAnimations = new Map();

function drawSensorChart(id, values, min, max) {
    const canvas = $(id);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;

    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(rect.width * ratio);
    const pixelHeight = Math.round(rect.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const left = 40;
    const right = 7;
    const top = 8;
    const bottom = 18;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const yFor = (value) => top + (1 - Math.min(1, Math.max(0, (value - min) / (max - min)))) * plotHeight;

    const prior = chartAnimations.get(id);
    const from = prior?.current?.length === values.length ? prior.current : values;
    const animation = { current: [...from], from: [...from], target: [...values], startedAt: performance.now() };
    chartAnimations.set(id, animation);

    const render = (now) => {
        if (chartAnimations.get(id) !== animation) return;
        const progress = Math.min(1, (now - animation.startedAt) / 360);
        const eased = 1 - (1 - progress) ** 3;
        animation.current = animation.target.map((value, index) => animation.from[index] + (value - animation.from[index]) * eased);

        context.clearRect(0, 0, width, height);
        context.font = "10px Inter, sans-serif";
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.lineWidth = 1;
        for (let tick = 0; tick <= 2; tick++) {
            const value = max - ((max - min) * tick) / 2;
            const y = top + (plotHeight * tick) / 2;
            context.strokeStyle = "#e5e3ee";
            context.beginPath();
            context.moveTo(left, y);
            context.lineTo(width - right, y);
            context.stroke();
            context.fillStyle = "#777386";
            context.fillText(Number.isInteger(value) ? String(value) : value.toFixed(1), left - 5, y);
        }

        const displayValues = animation.current;
        const gap = Math.min(5, plotWidth / (displayValues.length * 2));
        const barWidth = Math.max(2, (plotWidth - gap * (displayValues.length - 1)) / displayValues.length);
        const centers = displayValues.map((value, index) => {
            const x = left + index * (barWidth + gap);
            const y = yFor(value);
            const gradient = context.createLinearGradient(0, y, 0, top + plotHeight);
            gradient.addColorStop(0, "rgba(103, 58, 183, 0.72)");
            gradient.addColorStop(1, "rgba(146, 140, 195, 0.12)");
            context.fillStyle = gradient;
            context.beginPath();
            context.roundRect(x, y, barWidth, Math.max(0, top + plotHeight - y), [3, 3, 0, 0]);
            context.fill();
            return { x: x + barWidth / 2, y };
        });

        const trend = centers.map((point, index) => {
            const first = Math.max(0, index - 2);
            const average = displayValues.slice(first, index + 1).reduce((sum, value) => sum + value, 0) / (index - first + 1);
            return { x: point.x, y: yFor(average) };
        });
        if (trend.length) {
            const area = context.createLinearGradient(0, top, 0, top + plotHeight);
            area.addColorStop(0, "rgba(255, 145, 77, 0.15)");
            area.addColorStop(1, "rgba(255, 145, 77, 0)");
            context.beginPath();
            context.moveTo(trend[0].x, top + plotHeight);
            context.lineTo(trend[0].x, trend[0].y);
            for (let index = 1; index < trend.length; index++) {
                const previous = trend[index - 1];
                const point = trend[index];
                const middle = (previous.x + point.x) / 2;
                context.quadraticCurveTo(middle, previous.y, middle, (previous.y + point.y) / 2);
            }
            context.lineTo(trend[trend.length - 1].x, trend[trend.length - 1].y);
            context.lineTo(trend[trend.length - 1].x, top + plotHeight);
            context.closePath();
            context.fillStyle = area;
            context.fill();

            context.beginPath();
            context.moveTo(trend[0].x, trend[0].y);
            for (let index = 1; index < trend.length; index++) {
                const previous = trend[index - 1];
                const point = trend[index];
                const middle = (previous.x + point.x) / 2;
                context.quadraticCurveTo(middle, previous.y, middle, (previous.y + point.y) / 2);
            }
            context.lineTo(trend[trend.length - 1].x, trend[trend.length - 1].y);
            context.strokeStyle = "#ef8651";
            context.lineWidth = 2.5;
            context.lineJoin = "round";
            context.lineCap = "round";
            context.stroke();
        }
        if (progress < 1) requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
}

function updateSensorCharts(data) {
    const phMax = state.phIsRawAdc
        ? Math.max(10, Math.ceil(Math.max(data.ph, ...sensorHistory.ph) / 10) * 10)
        : 14;
    const ranges = {
        ph: [0, phMax],
        turbidity: [0, Math.max(state.turbidityIsRawAdc ? 4095 : 1500,
            Math.ceil(Math.max(data.turbidity, ...sensorHistory.turbidity) / 500) * 500)],
        moisture: [0, 100],
        tank1: [0, 100],
        tank2: [0, 100],
        temperature: [0, 50],
        humidity: [0, 100]
    };
    Object.entries(ranges).forEach(([key, [min, max]]) => {
        if (!Number.isFinite(data[key])) return;
        const history = sensorHistory[key];
        if (!history.length) history.push(...Array(11).fill(data[key]));
        history.push(data[key]);
        if (history.length > 12) history.shift();
        drawSensorChart(`${key}Chart`, history, min, max);
        if (["ph", "turbidity", "tank1", "tank2", "moisture", "temperature", "humidity"].includes(key)) {
            drawSensorChart(`data${key[0].toUpperCase()}${key.slice(1)}Chart`, history, min, max);
        }
    });
}

function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
}

function setStateClass(element, className) {
    element.classList.remove("state-good", "state-warning", "state-danger");
    element.classList.add(className);
}

function readSensors() {
    return {
        ph: Number(elements.ph.value),
        turbidity: Number(elements.turbidity.value),
        moisture: Number(elements.moisture.value),
        tank1: Number(elements.tank1.value),
        tank2: Number(elements.tank2.value),
        temperature: Number($("temperatureValue").textContent),
        humidity: Number($("humidityValue").textContent)
    };
}

function updateSensorLabels(data) {
    setText("phValue", state.phIsRawAdc ? `${data.ph}` : data.ph.toFixed(1));
    setText("phUnit", state.phIsRawAdc ? "ADC mentah" : "pH4502C");
    setText("turbidityValue", state.turbidityIsRawAdc ? `${data.turbidity.toFixed(0)} ADC` : `${data.turbidity.toFixed(1)} NTU`);
    setText("turbidityUnit", state.turbidityIsRawAdc ? "ADC mentah · clean water" : "Clean water clarity");
    const turbidityRange = elements.turbidity.closest(".sensor-item")?.querySelector(".range-label");
    if (turbidityRange) {
        turbidityRange.innerHTML = state.turbidityIsRawAdc
            ? "<span>ADC · 0</span><span>RAW SENSOR VALUE</span><span>ADC · 4095</span>"
            : "<span>KOTOR · ≤750 NTU</span><span>KERUH · 751–899 NTU</span><span>BERSIH · ≥900 NTU</span>";
    }
    setText("moistureValue", `${data.moisture}%`);
}

function updateTankVisuals(data) {
    $("rawWater").style.height = `${data.tank1}%`;
    $("cleanWater").style.height = `${data.tank2}%`;
    const transferring = data.tank1 >= 95 && data.tank2 < 95;
    $("tankProcess").classList.toggle("is-transferring", transferring);

    setText("tank1Label", `${data.tank1.toFixed(1)}%`);
    setText("tank2Label", `${data.tank2.toFixed(1)}%`);
    setText("rawPercentage", `${data.tank1.toFixed(1)}%`);
    setText("cleanPercentage", `${data.tank2.toFixed(1)}%`);
}

function getTurbidityCategory(value) {
    if (value >= 900) return { label: "BERSIH", className: "state-good" };
    if (value > 750) return { label: "KERUH", className: "state-warning" };
    return { label: "KOTOR", className: "state-danger" };
}

function evaluateWater(data) {
    const quality = $("waterQuality");
    const cleanQualityStatus = $("cleanQualityStatus");
    if (state.phIsRawAdc) {
        quality.textContent = "KALIBRASI pH";
        setStateClass(quality, "state-warning");
        cleanQualityStatus.textContent = "SEDANG";
        setStateClass(cleanQualityStatus, "state-warning");
        return false;
    }
    if (state.turbidityIsRawAdc) {
        quality.textContent = "KALIBRASI NTU";
        setStateClass(quality, "state-warning");
        cleanQualityStatus.textContent = "SEDANG";
        setStateClass(cleanQualityStatus, "state-warning");
        return false;
    }

    // Demonstration thresholds only. Not a drinking-water certification.
    const phWithinTarget = data.ph >= 6.5 && data.ph <= 8.5;
    const turbidityWithinTarget = data.turbidity >= 900;
    const passed = phWithinTarget && turbidityWithinTarget;
    const moderate = data.ph >= 6 && data.ph <= 9 && data.turbidity > 750 && data.turbidity < 900;
    const category = getTurbidityCategory(data.turbidity);
    cleanQualityStatus.textContent = category.label;
    setStateClass(cleanQualityStatus, category.className);

    if (passed) {
        quality.textContent = "NORMAL";
        setStateClass(quality, "state-good");
    } else if (moderate) {
        quality.textContent = "PERLU CEK";
        setStateClass(quality, "state-warning");
    } else {
        quality.textContent = "BUTUH REFILTER";
        setStateClass(quality, "state-danger");
    }

    return passed;
}

function updateFiltrationSummary(data, waterPassed) {
    const phCondition = $("phCondition");
    if (state.phIsRawAdc) {
        phCondition.textContent = `${data.ph.toFixed(0)} ADC · KALIBRASI`;
        setStateClass(phCondition, "state-warning");
    } else {
        const phOkay = data.ph >= 6.5 && data.ph <= 8.5;
        phCondition.textContent = `${data.ph.toFixed(1)} · ${phOkay ? "SESUAI" : "DI LUAR"}`;
        setStateClass(phCondition, phOkay ? "state-good" : "state-danger");
    }

    const turbidityValue = $("filterTurbidityValue");
    const turbidityState = $("filterTurbidityState");
    if (state.turbidityIsRawAdc) {
        turbidityValue.textContent = `${data.turbidity.toFixed(0)} ADC · belum NTU`;
        turbidityState.textContent = "KALIBRASI";
        setStateClass(turbidityState, "state-warning");
    } else {
        turbidityValue.textContent = `${data.turbidity.toFixed(1)} NTU`;
        const category = getTurbidityCategory(data.turbidity);
        turbidityState.textContent = category.label;
        setStateClass(turbidityState, category.className);
    }

    const recommendation = $("filterRecommendation");
    recommendation.textContent = state.phIsRawAdc || state.turbidityIsRawAdc
        ? "KALIBRASI SENSOR"
        : (waterPassed ? "NORMAL" : "REFILTER");
    setStateClass(recommendation, state.phIsRawAdc || state.turbidityIsRawAdc ? "state-warning" : (waterPassed ? "state-good" : "state-danger"));
}

function evaluateTank(data) {
    const capacityStatus = $("dataCapacityStatus");

    if (data.tank2 >= 95) {
        capacityStatus.textContent = "HAMPIR PENUH";
        setStateClass(capacityStatus, "state-danger");
    } else if (data.tank2 <= 10) {
        capacityStatus.textContent = "RENDAH";
        setStateClass(capacityStatus, "state-warning");
    } else {
        capacityStatus.textContent = "TERSEDIA";
        setStateClass(capacityStatus, "state-good");
    }
}

function updateReservoirStatus() {
    const visual = $("reservoirVisual");
    const summary = $("reservoirStatus");
    const status = $("reservoirVisualStatus");
    const description = $("reservoirDescription");
    const sensorState = $("reservoirSensorState");
    const pumpState = $("reservoirPumpState");
    if (!visual || !summary || !status || !description || !sensorState || !pumpState) return;

    const full = state.reservoirFull;
    const filling = !full && state.pumps.pump3;
    visual.dataset.state = full ? "full" : (filling ? "filling" : "empty");
    visual.setAttribute("aria-label", full ? "Tandon air penuh" : (filling ? "Air mengalir melalui pipa ke tandon" : "Tandon belum penuh dan air tidak mengalir"));
    summary.textContent = full ? "PENUH" : (filling ? "MENGISI" : (state.reservoirReadingAvailable ? "BELUM PENUH" : "0% · OFF"));
    setStateClass(summary, full ? "state-good" : (filling ? "state-warning" : "state-warning"));
    status.textContent = full ? "TANDON PENUH" : (filling ? "AIR SEDANG MENGISI" : "BELUM PENUH");
    description.textContent = full
        ? "Sensor kabel mendeteksi batas penuh; aliran air berhenti."
        : (filling
            ? "Pompa transfer aktif; air mengalir melalui pipa ke galon."
            : (state.reservoirReadingAvailable ? "Pompa transfer mati; air tidak mengalir." : "Nilai awal 0%; pompa transfer mati, jadi air tidak mengalir."));
    sensorState.textContent = full ? "PENUH" : (state.reservoirReadingAvailable ? "BELUM PENUH" : "DEFAULT 0%");
    pumpState.textContent = state.pumps.pump3 && !full ? "ON" : "OFF";
}

function updateProcess(data, waterPassed) {
    const flowMode = $("flowMode");
    const transferStatus = $("transferStatus");

    if (data.tank2 >= 95) {
        flowMode.textContent = "STOP";
        transferStatus.textContent = "TANK 02 HIGH LEVEL";
        setStateClass(flowMode, "state-danger");
    } else if (data.tank1 >= 95) {
        flowMode.textContent = "FILTERASI";
        transferStatus.textContent = "AIR MELEWATI FILTER";
        setStateClass(flowMode, "state-good");
    } else if (state.phIsRawAdc || state.turbidityIsRawAdc) {
        flowMode.textContent = "KALIBRASI";
        transferStatus.textContent = "QUALITY UNKNOWN";
        setStateClass(flowMode, "state-warning");
    } else if (!waterPassed) {
        flowMode.textContent = "REFILTER";
        transferStatus.textContent = "QUALITY CHECK REQUIRED";
        setStateClass(flowMode, "state-warning");
    } else {
        flowMode.textContent = "MENUNGGU LEVEL";
        transferStatus.textContent = "MENUNGGU SENSOR 95%";
        setStateClass(flowMode, "state-warning");
    }
}

function updateLCD(data, waterPassed) {
    const p1 = state.pumps.pump1 ? "ON" : "OFF";
    const p2 = state.pumps.pump2 ? "ON" : "OFF";
    const p3 = state.pumps.pump3 ? "ON" : "OFF";
    const p4 = state.pumps.pump4 ? "ON" : "OFF";

    const phLabel = state.phIsRawAdc ? `PH ADC: ${data.ph}` : `PH: ${data.ph.toFixed(1)}`;
    setText("lcd1", `${phLabel}  TURB: ${data.turbidity.toFixed(1)} NTU`);
    setText("lcd2", `NETRAL: ${data.tank1.toFixed(0)}%  BERSIH: ${data.tank2.toFixed(0)}%`);
    setText("lcd3", state.phIsRawAdc
        ? "MODE: pH ADC CALIBRATION"
        : `MODE: ${waterPassed ? "PASS" : "CHECK"} / ${data.tank2 >= 95 ? "STOP" : "PROCESS"}`);
    setText("lcd4", `P1: ${p1}  P2: ${p2}  P3: ${p3}  P4: ${p4}`);
}

function updatePumpButtons() {
    Object.entries(state.pumps).forEach(([key, active]) => {
        const button = elements[key];
        if (!button) return;
        button.classList.toggle("active", active);
        button.textContent = active ? "ON" : "OFF";
        button.setAttribute("aria-pressed", String(active));
    });
    const uvActive = state.pumps.uv;
    const plantScene = $("plantScene");
    if (plantScene) {
        plantScene.dataset.uv = uvActive ? "on" : "off";
        plantScene.setAttribute("aria-label", `${plantScene.dataset.condition === "dry" ? "Animasi tanaman kering" : "Animasi tanaman segar"}${uvActive ? ", disinari lampu UV" : ""}`);
    }
    setText("uvStatus", uvActive ? "UV ON" : "UV OFF");
    if (elements.uv) elements.uv.setAttribute("aria-label", uvActive ? "Matikan lampu UV" : "Nyalakan lampu UV");
    const uvScheduleEnabled = $("uvScheduleEnabled")?.checked || false;
    if (elements.uv) elements.uv.disabled = uvScheduleEnabled;
    const mode = $("gardenMode")?.value || "AUTO";
    const sensorFields = $("gardenSensorFields");
    const scheduleFields = $("gardenScheduleFields");
    if (sensorFields) sensorFields.hidden = mode !== "AUTO";
    if (scheduleFields) scheduleFields.hidden = mode !== "MANUAL";
    ["moistureOnThreshold", "moistureOffThreshold"].forEach((id) => {
        const input = $(id);
        if (input) input.disabled = mode !== "AUTO";
    });
    document.querySelectorAll("#gardenScheduleList .schedule-start, #gardenScheduleList .schedule-end")
        .forEach((input) => { input.disabled = mode !== "MANUAL"; });
}

function updateDashboard() {
    const data = readSensors();

    updateSensorLabels(data);
    updatePlantCondition(data.moisture);
    updateSensorCharts(data);
    updateTankVisuals(data);

    const waterPassed = evaluateWater(data);
    evaluateTank(data);
    updateProcess(data, waterPassed);
    updateFiltrationSummary(data, waterPassed);
    updateReservoirStatus();
    updatePumpButtons();
    updateLCD(data, waterPassed);
    updateDataPage(data);
}

function updateGaugeCard(cardId, valueId, value, min, max, displayValue, unit) {
    const card = $(cardId);
    const valueNode = $(valueId);
    if (!card || !valueNode) return;
    const progress = Number.isFinite(value) && max > min
        ? Math.min(1, Math.max(0, (value - min) / (max - min)))
        : 0;
    const progressPath = card.querySelector(".gauge-progress");
    if (progressPath) progressPath.style.strokeDasharray = `${235 * progress} 235`;
    valueNode.textContent = displayValue;
    const unitNode = valueNode.nextElementSibling;
    if (unitNode && unit) unitNode.textContent = unit;
}

function copyStatusCard(sourceId, targetId) {
    const source = $(sourceId);
    const target = $(targetId);
    if (!source || !target) return;
    target.textContent = source.textContent;
    ["state-good", "state-warning", "state-danger"].forEach((className) => {
        target.classList.toggle(className, source.classList.contains(className));
    });
}

function updateDataPage(data) {
    const phMax = Number(elements.ph.max) || 14;
    const turbidityMax = Number(elements.turbidity.max) || 100;
    updateGaugeCard("dataPhCard", "dataPhValue", data.ph, 0, phMax,
        state.phIsRawAdc ? data.ph.toFixed(0) : data.ph.toFixed(1), state.phIsRawAdc ? "ADC" : "pH");
    $("dataPhUnit").textContent = state.phIsRawAdc ? "ADC" : "pH";
    $("dataPhSensor").textContent = state.phIsRawAdc ? "ADC MENTAH" : "pH4502C";
    $("dataPhRangeUnit").textContent = state.phIsRawAdc ? "ADC" : "pH";
    $("dataPhMax").textContent = String(phMax);
    updateGaugeCard("dataTurbidityCard", "dataTurbidityValue", data.turbidity, 0, turbidityMax,
        state.turbidityIsRawAdc ? data.turbidity.toFixed(0) : data.turbidity.toFixed(1), state.turbidityIsRawAdc ? "ADC" : "NTU");
    $("dataTurbiditySensor").textContent = state.turbidityIsRawAdc ? "ADC MENTAH" : "TURBIDITY";
    $("dataTurbidityRangeUnit").textContent = state.turbidityIsRawAdc ? "ADC" : "NTU";
    $("dataTurbidityMax").textContent = String(turbidityMax);
    updateGaugeCard("dataTank1Card", "dataTank1Value", data.tank1, 0, 100, data.tank1.toFixed(1), "%");
    updateGaugeCard("dataTank2Card", "dataTank2Value", data.tank2, 0, 100, data.tank2.toFixed(1), "%");
    updateGaugeCard("dataMoistureCard", "dataMoistureValue", data.moisture, 0, 100, data.moisture.toFixed(0), "%");

    const temperature = Number($("temperatureValue").textContent);
    const humidity = Number($("humidityValue").textContent);
    updateGaugeCard("dataTemperatureCard", "dataTemperatureValue", temperature, 0, 50,
        Number.isFinite(temperature) ? temperature.toFixed(1) : "--", "°C");
    updateGaugeCard("dataHumidityCard", "dataHumidityValue", humidity, 0, 100,
        Number.isFinite(humidity) ? humidity.toFixed(1) : "--", "%");
    copyStatusCard("waterQuality", "dataWaterQuality");
    copyStatusCard("flowMode", "dataFlowMode");
}

function updatePlantCondition(moisture) {
    const scene = $("plantScene");
    const condition = $("plantCondition");
    const reading = $("plantMoisture");
    if (!scene || !condition || !reading) return;

    const isDry = moisture <= 30;
    scene.dataset.condition = isDry ? "dry" : "fresh";
    scene.setAttribute("aria-label", isDry ? "Animasi tanaman kering" : "Animasi tanaman segar");
    condition.textContent = isDry ? "TANAMAN KERING" : "TANAMAN SEGAR";
    reading.textContent = `Kelembaban tanah ${moisture}%`;
}

let firebaseControlWriteQueue = Promise.resolve();
const pendingPumpWrites = new Map();
const recentPumpWrites = new Map();
let uvScheduleDirty = false;
let gardenSettingsDirty = false;

function getScheduleValues(listId) {
    return Array.from($(listId).querySelectorAll("[data-schedule-row]")).map((row) => ({
        startTime: row.querySelector(".schedule-start").value,
        stopTime: row.querySelector(".schedule-end").value
    }));
}

function createScheduleRow(listId, index) {
    const uv = listId === "uvScheduleList";
    const row = document.createElement("div");
    row.className = "schedule-row";
    row.dataset.scheduleRow = "";
    const times = document.createElement("div");
    times.className = "schedule-time-grid";
    [[uv ? "Hidup pukul" : "Mulai siram", uv ? "18:00" : "07:00", "schedule-start"],
        [uv ? "Mati pukul" : "Berhenti", uv ? "06:00" : "07:05", "schedule-end"]].forEach(([caption, value, className]) => {
        const label = document.createElement("label");
        label.textContent = caption;
        const input = document.createElement("input");
        input.type = "time";
        input.value = value;
        input.required = true;
        input.className = className;
        input.id = `${listId}-${index}-${className}`;
        label.append(input);
        times.append(label);
    });
    const remove = document.createElement("button");
    remove.className = "schedule-remove";
    remove.type = "button";
    remove.dataset.removeSchedule = "";
    remove.setAttribute("aria-label", "Hapus jadwal");
    remove.textContent = "Hapus";
    row.append(times, remove);
    return row;
}

function setScheduleValues(listId, schedules, fallback) {
    const list = $(listId);
    const rows = Array.from(list.querySelectorAll("[data-schedule-row]"));
    const normalized = Array.isArray(schedules) && schedules.length
        ? schedules
        : [fallback];
    rows.slice(1).forEach((row) => row.remove());
    normalized.forEach((schedule, index) => {
        const row = index === 0 ? rows[0] : createScheduleRow(listId, index + 1);
        if (index > 0) list.append(row);
        row.querySelector(".schedule-start").value = schedule.startTime || fallback.startTime;
        row.querySelector(".schedule-end").value = schedule.stopTime || fallback.stopTime;
    });
    updateScheduleRemoveButtons(list);
}

function updateScheduleRemoveButtons(list) {
    const rows = Array.from(list.querySelectorAll("[data-schedule-row]"));
    rows.forEach((row) => { row.querySelector("[data-remove-schedule]").disabled = rows.length === 1; });
}

function initializeScheduleList(listId, markDirty) {
    const list = $(listId);
    const addButton = document.querySelector(`[data-add-schedule="${listId}"]`);
    if (!list || !addButton) return;
    let nextIndex = list.querySelectorAll("[data-schedule-row]").length + 1;
    addButton.addEventListener("click", () => {
        list.append(createScheduleRow(listId, nextIndex++));
        updateScheduleRemoveButtons(list);
        markDirty();
    });
    list.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-schedule]");
        if (!remove || remove.disabled) return;
        remove.closest("[data-schedule-row]").remove();
        updateScheduleRemoveButtons(list);
        markDirty();
    });
    updateScheduleRemoveButtons(list);
}

async function sendFirebaseControlPatch(controlPatch) {
    const send = async (token) => firebaseJsonRequest(
        `${firebaseConfig.databaseURL}/ecowast/control.json?auth=${encodeURIComponent(token)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(controlPatch)
        }
    );

    try {
        const token = await getFirebaseIdToken();
        await send(token);
    } catch (error) {
        if (error.status !== 401) throw error;
        await send(await getFirebaseIdToken(true));
    }
}

function queueFirebaseControlWrite(controlPatch) {
    const write = () => sendFirebaseControlPatch(controlPatch);
    const queuedWrite = firebaseControlWriteQueue.then(write, write);
    firebaseControlWriteQueue = queuedWrite.catch(() => {});
    return queuedWrite;
}

function togglePump(key) {
    const previousValue = state.pumps[key];
    const nextValue = !previousValue;
    state.pumps[key] = nextValue;
    pendingPumpWrites.set(key, nextValue);
    updateDashboard();

    const controlPatch = { [key]: nextValue, pump5: null };
    const queuedWrite = queueFirebaseControlWrite(controlPatch);
    queuedWrite.then(() => {
        recentPumpWrites.set(key, Date.now());
        if (pendingPumpWrites.get(key) === nextValue) pendingPumpWrites.delete(key);
    });
    queuedWrite.catch((error) => {
        if (pendingPumpWrites.get(key) === nextValue) pendingPumpWrites.delete(key);
        if (state.pumps[key] === nextValue) {
            state.pumps[key] = previousValue;
            updateDashboard();
        }
        setText("dataSourceStatus", "CONTROL WRITE FAILED");
        console.error(`ECOWAST failed to write ${key}:`, error);
    });
}

function initializeAutomationSettings() {
    const uvForm = $("uvScheduleForm");
    const gardenForm = $("gardenSettingsForm");
    const uvEnabled = $("uvScheduleEnabled");
    const gardenMode = $("gardenMode");
    if (!uvForm || !gardenForm || !uvEnabled || !gardenMode) return;

    uvForm.addEventListener("input", () => { uvScheduleDirty = true; });
    uvForm.addEventListener("change", () => {
        uvScheduleDirty = true;
        updatePumpButtons();
    });
    gardenForm.addEventListener("input", () => { gardenSettingsDirty = true; });
    gardenForm.addEventListener("change", () => {
        gardenSettingsDirty = true;
        updatePumpButtons();
    });
    initializeScheduleList("uvScheduleList", () => { uvScheduleDirty = true; });
    initializeScheduleList("gardenScheduleList", () => {
        gardenSettingsDirty = true;
        updatePumpButtons();
    });

    uvForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = uvForm.querySelector("button[type=submit]");
        const schedules = getScheduleValues("uvScheduleList");
        setText("uvScheduleStatus", "Menyimpan jadwal...");
        if (button) button.disabled = true;
        try {
            await queueFirebaseControlWrite({
                uvSchedule: {
                    enabled: uvEnabled.checked,
                    schedules: schedules.map(({ startTime, stopTime }) => ({ onTime: startTime, offTime: stopTime })),
                    onTime: schedules[0].startTime,
                    offTime: schedules[0].stopTime,
                    timezone: "Asia/Jakarta"
                }
            });
            uvScheduleDirty = false;
            setText("uvScheduleStatus", "Jadwal tersimpan di Firebase.");
            updatePumpButtons();
        } catch (error) {
            setText("uvScheduleStatus", "Gagal menyimpan jadwal.");
            setText("dataSourceStatus", "CONTROL WRITE FAILED");
            console.error("ECOWAST failed to save UV schedule:", error);
        } finally {
            if (button) button.disabled = false;
        }
    });

    gardenForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = gardenForm.querySelector("button[type=submit]");
        const moistureOnBelow = Number($("moistureOnThreshold").value);
        const moistureOffAbove = Number($("moistureOffThreshold").value);
        const schedules = getScheduleValues("gardenScheduleList");
        if (gardenMode.value === "AUTO" && moistureOnBelow >= moistureOffAbove) {
            setText("gardenSettingsStatus", "Ambang mulai harus lebih rendah dari ambang berhenti.");
            return;
        }
        if (gardenMode.value === "MANUAL" && schedules.some(({ startTime, stopTime }) => startTime === stopTime)) {
            setText("gardenSettingsStatus", "Waktu mulai dan berhenti setiap jadwal harus berbeda.");
            return;
        }

        setText("gardenSettingsStatus", "Menyimpan pengaturan...");
        if (button) button.disabled = true;
        try {
            await queueFirebaseControlWrite({
                gardenMode: gardenMode.value,
                gardenSchedule: {
                    schedules,
                    startTime: schedules[0].startTime,
                    stopTime: schedules[0].stopTime,
                    timezone: "Asia/Jakarta"
                },
                gardenSensor: { moistureOnBelow, moistureOffAbove }
            });
            gardenSettingsDirty = false;
            setText("gardenSettingsStatus", "Pengaturan tersimpan di Firebase.");
        } catch (error) {
            setText("gardenSettingsStatus", "Gagal menyimpan pengaturan.");
            setText("dataSourceStatus", "CONTROL WRITE FAILED");
            console.error("ECOWAST failed to save garden settings:", error);
        } finally {
            if (button) button.disabled = false;
        }
    });

    updatePumpButtons();
}

elements.ph.addEventListener("input", updateDashboard);
elements.turbidity.addEventListener("input", updateDashboard);
elements.moisture.addEventListener("input", updateDashboard);
elements.tank1.addEventListener("input", updateDashboard);
elements.tank2.addEventListener("input", updateDashboard);

elements.pump1.addEventListener("click", () => togglePump("pump1"));
elements.pump2.addEventListener("click", () => togglePump("pump2"));
elements.pump3.addEventListener("click", () => togglePump("pump3"));
elements.pump4.addEventListener("click", () => togglePump("pump4"));
elements.uv.addEventListener("click", () => togglePump("uv"));

function updateClock() {
    const now = new Date();
    const clock = $("clock");
    if (clock) {
        clock.textContent = now.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        });
    }
}


function updateWelcomeDate() {
    const target = document.getElementById("welcomeDate");
    if (!target) return;

    target.textContent = new Date().toLocaleDateString("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function initializeProfileSettings() {
    const usernameDisplay = $("operatorUsername");
    const usernameInput = $("usernameInput");
    const settingsToggle = $("settingsToggle");
    const settingsPanel = $("settingsPanel");
    if (!usernameDisplay || !usernameInput || !settingsToggle || !settingsPanel) return;

    const savedUsername = localStorage.getItem("ecowast-username");
    if (savedUsername) usernameDisplay.textContent = savedUsername;
    usernameInput.value = usernameDisplay.textContent;

    settingsToggle.addEventListener("click", () => {
        const open = settingsPanel.hidden;
        settingsPanel.hidden = !open;
        settingsToggle.setAttribute("aria-expanded", String(open));
        if (open) usernameInput.focus();
    });

    settingsPanel.addEventListener("submit", (event) => {
        event.preventDefault();
        const username = usernameInput.value.trim();
        if (!username) return;
        usernameDisplay.textContent = username;
        localStorage.setItem("ecowast-username", username);
        settingsPanel.hidden = true;
        settingsToggle.setAttribute("aria-expanded", "false");
    });
}

function initializeSensorCarousel() {
    const carousel = $("sensorCarousel");
    const track = $("sensorTrack");
    const previous = $("sensorPrevious");
    const next = $("sensorNext");
    const page = $("sensorPage");
    if (!carousel || !track || !previous || !next || !page) return;

    const slides = Array.from(track.querySelectorAll(".sensor-item")).filter((slide) => !slide.hidden);
    let activeIndex = 0;
    let touchStartX = null;

    function showSlide(index) {
        activeIndex = Math.max(0, Math.min(index, slides.length - 1));
        track.style.transform = `translateX(-${activeIndex * 100}%)`;
        page.textContent = `${activeIndex + 1} / ${slides.length}`;
        previous.disabled = activeIndex === 0;
        next.disabled = activeIndex === slides.length - 1;
        slides.forEach((slide, slideIndex) => {
            slide.setAttribute("aria-hidden", String(slideIndex !== activeIndex));
            slide.inert = slideIndex !== activeIndex;
        });
    }

    previous.addEventListener("click", () => showSlide(activeIndex - 1));
    next.addEventListener("click", () => showSlide(activeIndex + 1));
    carousel.addEventListener("touchstart", (event) => {
        if (event.target.closest("input, button")) return;
        touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });
    carousel.addEventListener("touchend", (event) => {
        if (touchStartX === null) return;
        const distance = event.changedTouches[0].clientX - touchStartX;
        if (Math.abs(distance) > 45) showSlide(activeIndex + (distance < 0 ? 1 : -1));
        touchStartX = null;
    }, { passive: true });
    showSlide(activeIndex);
}

function initializePageSelector() {
    const dashboard = document.querySelector(".dashboard");
    const selector = document.querySelector(".page-switch");
    if (!dashboard || !selector) return;

    selector.querySelectorAll(".page-switch-button").forEach((button) => {
        button.addEventListener("click", () => {
            const page = button.dataset.page;
            dashboard.classList.toggle("is-data", page === "data");
            dashboard.classList.toggle("is-garden", page === "garden");
            dashboard.classList.toggle("is-pumps", page === "pumps");
            selector.classList.toggle("is-data", page === "data");
            selector.classList.toggle("is-garden", page === "garden");
            selector.classList.toggle("is-pumps", page === "pumps");
            selector.querySelectorAll(".page-switch-button").forEach((item) => {
                const active = item === button;
                item.classList.toggle("is-active", active);
                item.setAttribute("aria-pressed", String(active));
            });
            updateDashboard();
        });
    });
}

const firebaseConfig = {
    apiKey: "AIzaSyDc2cFaWbfWKtIPGXaUR3wMpz2bsHofi5s",
    databaseURL: "https://ecowastfirebase-default-rtdb.asia-southeast1.firebasedatabase.app"
};

let firebaseIdToken = "";
let firebaseRefreshToken = "";
let firebaseTokenExpiresAt = 0;
let firebaseSyncRunning = false;
async function firebaseJsonRequest(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(payload?.error?.message || `HTTP_${response.status}`);
        error.status = response.status;
        throw error;
    }
    return payload;
}

function saveFirebaseRefreshToken(token) {
    firebaseRefreshToken = token;
    try {
        sessionStorage.setItem("ecowastFirebaseRefreshToken", token);
    } catch (_) {
        // The current page can still use the in-memory token for this session.
    }
}

async function getFirebaseIdToken(forceRefresh = false) {
    if (!forceRefresh && firebaseIdToken && Date.now() < firebaseTokenExpiresAt - 60000) {
        return firebaseIdToken;
    }

    if (!firebaseRefreshToken) {
        try {
            firebaseRefreshToken = sessionStorage.getItem("ecowastFirebaseRefreshToken") || "";
        } catch (_) {
            firebaseRefreshToken = "";
        }
    }

    if (firebaseRefreshToken) {
        try {
            const body = new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: firebaseRefreshToken
            });
            const refreshed = await firebaseJsonRequest(
                `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
                { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
            );
            firebaseIdToken = refreshed.id_token;
            saveFirebaseRefreshToken(refreshed.refresh_token || firebaseRefreshToken);
            firebaseTokenExpiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
            return firebaseIdToken;
        } catch (_) {
            firebaseRefreshToken = "";
            try { sessionStorage.removeItem("ecowastFirebaseRefreshToken"); } catch (_) { /* Ignore storage errors. */ }
        }
    }

    const signedIn = await firebaseJsonRequest(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ returnSecureToken: true })
        }
    );
    firebaseIdToken = signedIn.idToken;
    saveFirebaseRefreshToken(signedIn.refreshToken);
    firebaseTokenExpiresAt = Date.now() + Number(signedIn.expiresIn || 3600) * 1000;
    return firebaseIdToken;
}

function applyFirebaseSensorData(sensorData, statusData = null) {
    if (!sensorData || typeof sensorData !== "object") {
        throw new Error("SENSOR_DATA_MISSING");
    }
    state.phIsRawAdc = sensorData.ph === undefined && sensorData.phRaw !== undefined;
    state.turbidityIsRawAdc = sensorData.turbidity === undefined && sensorData.turbidityRaw !== undefined;
    let reservoirSignal = sensorData.reservoirFull ?? sensorData.tandonFull ?? sensorData.waterLevelFull ?? sensorData.waterLevelCable ?? sensorData.cableWaterLevel ?? sensorData.waterLevelSensor ?? sensorData.waterLevel ?? sensorData.water_level;
    state.reservoirReadingAvailable = reservoirSignal !== undefined && reservoirSignal !== null;
    if (reservoirSignal && typeof reservoirSignal === "object") {
        reservoirSignal = reservoirSignal.full ?? reservoirSignal.isFull ?? reservoirSignal.value;
    }
    if (typeof reservoirSignal === "boolean") {
        state.reservoirFull = reservoirSignal;
    } else if (typeof reservoirSignal === "number" && Number.isFinite(reservoirSignal)) {
        state.reservoirFull = reservoirSignal === 0 || reservoirSignal === 1
            ? reservoirSignal === 1
            : reservoirSignal >= 95;
    } else if (typeof reservoirSignal === "string") {
        const normalized = reservoirSignal.trim().toLowerCase();
        if (["true", "1", "full", "penuh", "high"].includes(normalized)) state.reservoirFull = true;
        else if (["false", "0", "not full", "belum penuh", "low", "filling"].includes(normalized)) state.reservoirFull = false;
        else state.reservoirFull = false;
    } else {
        state.reservoirFull = false;
    }
    const fields = [
        ["ph", state.phIsRawAdc ? "phRaw" : "ph"],
        ["turbidity", state.turbidityIsRawAdc ? "turbidityRaw" : "turbidity"],
        ["moisture", "soilMoisture"],
        ["tank1", sensorData.tank1Level !== undefined ? "tank1Level" : (sensorData.rawTankLevel !== undefined ? "rawTankLevel" : (sensorData.US1 !== undefined ? "US1" : (sensorData.us1 !== undefined ? "us1" : "tank1")))],
        ["tank2", sensorData.tank2Level !== undefined ? "tank2Level" : (sensorData.cleanTankLevel !== undefined ? "cleanTankLevel" : (sensorData.US2 !== undefined ? "US2" : (sensorData.us2 !== undefined ? "us2" : "tank2")))]
    ];
    let updated = 0;

    fields.forEach(([inputKey, firebaseKey]) => {
        const value = Number(sensorData[firebaseKey]);
        if (sensorData[firebaseKey] === undefined || !Number.isFinite(value) || value < 0) return;

        const input = elements[inputKey];
        const usesRawRange = (inputKey === "ph" && state.phIsRawAdc) || (inputKey === "turbidity" && state.turbidityIsRawAdc);
        const maxValue = usesRawRange ? Math.max(4095, value)
            : inputKey === "ph" ? 14
                : inputKey === "turbidity" ? Math.max(1200, Math.ceil(value / 1000) * 1000)
                    : 100;
        const clampedValue = Math.min(maxValue, Math.max(0, value));
        input.max = String(maxValue);
        input.value = String(clampedValue);
        input.disabled = true;
        updated++;
    });

    const dhtData = sensorData.dht11 && typeof sensorData.dht11 === "object" ? sensorData.dht11 : sensorData;
    const temperature = Number(dhtData.temperature ?? dhtData.temp);
    const humidity = Number(statusData?.humidity ?? dhtData.humidity ?? dhtData.hum);
    const hasTemperature = Number.isFinite(temperature) && temperature >= 0;
    const hasHumidity = Number.isFinite(humidity) && humidity >= 0 && statusData?.dhtValid !== 0;
    if (hasTemperature) setText("temperatureValue", temperature.toFixed(1));
    if (hasHumidity) setText("humidityValue", humidity.toFixed(1));
    if (!updated) throw new Error("SENSOR_DATA_MISSING");
    [elements.ph, elements.turbidity, elements.moisture, elements.tank1, elements.tank2]
        .forEach((input) => { input.disabled = true; });

    state.firebaseLive = true;
    state.firebaseDataLoaded = true;
    setText("dataSourceStatus", updated === fields.length ? "FIREBASE LIVE" : "FIREBASE PARTIAL");
    updateDashboard();
}

function applyFirebaseControlData(controlData) {
    if (!controlData || typeof controlData !== "object") return;
    const firebaseKeys = { pump1: "pump1", pump2: "pump2", pump3: "pump3", pump4: "pump4", uv: "uv" };
    Object.entries(firebaseKeys).forEach(([stateKey, firebaseKey]) => {
        const value = controlData[firebaseKey];
        const recentWriteAt = recentPumpWrites.get(stateKey) || 0;
        if (pendingPumpWrites.has(stateKey) || Date.now() - recentWriteAt < 5000) return;
        if (value === true || value === false || value === 0 || value === 1 || value === "0" || value === "1") {
            state.pumps[stateKey] = value === true || Number(value) === 1;
        }
    });

    const uvSchedule = controlData.uvSchedule;
    if (!uvScheduleDirty && !$("uvScheduleForm").contains(document.activeElement) && uvSchedule && typeof uvSchedule === "object") {
        if (typeof uvSchedule.enabled === "boolean") $("uvScheduleEnabled").checked = uvSchedule.enabled;
        const uvTimes = Array.isArray(uvSchedule.schedules)
            ? uvSchedule.schedules.map((item) => ({
                startTime: item.onTime || item.startTime,
                stopTime: item.offTime || item.stopTime
            }))
            : null;
        setScheduleValues("uvScheduleList", uvTimes, {
            startTime: uvSchedule.onTime || "18:00",
            stopTime: uvSchedule.offTime || "06:00"
        });
    }

    if (!gardenSettingsDirty && !$("gardenSettingsForm").contains(document.activeElement)) {
        if (controlData.gardenMode === "AUTO" || controlData.gardenMode === "MANUAL") {
            $("gardenMode").value = controlData.gardenMode;
        }
        const schedule = controlData.gardenSchedule;
        if (schedule && typeof schedule === "object") {
            setScheduleValues("gardenScheduleList", schedule.schedules, {
                startTime: schedule.startTime || "07:00",
                stopTime: schedule.stopTime || "07:05"
            });
        }
        const sensorConfig = controlData.gardenSensor;
        if (sensorConfig && typeof sensorConfig === "object") {
            if (Number.isFinite(Number(sensorConfig.moistureOnBelow))) $("moistureOnThreshold").value = sensorConfig.moistureOnBelow;
            if (Number.isFinite(Number(sensorConfig.moistureOffAbove))) $("moistureOffThreshold").value = sensorConfig.moistureOffAbove;
        }
    }
    updatePumpButtons();
}

async function syncFirebaseSensors() {
    if (firebaseSyncRunning) return;
    firebaseSyncRunning = true;

    try {
        const token = await getFirebaseIdToken();
        const endpoint = `${firebaseConfig.databaseURL}/ecowast/sensor.json?auth=${encodeURIComponent(token)}`;
        let sensorData;
        try {
            sensorData = await firebaseJsonRequest(endpoint, { cache: "no-store" });
        } catch (error) {
            if (error.status !== 401) throw error;
            const refreshedToken = await getFirebaseIdToken(true);
            const retryEndpoint = `${firebaseConfig.databaseURL}/ecowast/sensor.json?auth=${encodeURIComponent(refreshedToken)}`;
            sensorData = await firebaseJsonRequest(retryEndpoint, { cache: "no-store" });
        }

        let controlData = null;
        try {
            controlData = await firebaseJsonRequest(
                `${firebaseConfig.databaseURL}/ecowast/control.json?auth=${encodeURIComponent(firebaseIdToken || token)}`,
                { cache: "no-store" }
            );
        } catch (error) {
            if (error.status === 401) {
                try {
                    const refreshedToken = await getFirebaseIdToken(true);
                    controlData = await firebaseJsonRequest(
                        `${firebaseConfig.databaseURL}/ecowast/control.json?auth=${encodeURIComponent(refreshedToken)}`,
                        { cache: "no-store" }
                    );
                } catch (_) {
                    controlData = null;
                }
            }
        }
        let statusData = null;
        try {
            statusData = await firebaseJsonRequest(
                `${firebaseConfig.databaseURL}/ecowast/status.json?auth=${encodeURIComponent(firebaseIdToken || token)}`,
                { cache: "no-store" }
            );
        } catch (_) {
            statusData = null;
        }
        applyFirebaseControlData({
            ...(statusData && typeof statusData === "object" ? statusData : {}),
            ...(controlData && typeof controlData === "object" ? controlData : {})
        });
        // The current firmware publishes live sensor fields under /status.
        // Merge it over /sensor so the newest firmware schema takes priority.
        const liveSensorData = statusData && typeof statusData === "object"
            ? { ...(sensorData && typeof sensorData === "object" ? sensorData : {}), ...statusData }
            : sensorData;
        applyFirebaseSensorData(liveSensorData, statusData);
    } catch (error) {
        const message = String(error.message || "").toUpperCase();
        let status = "FIREBASE OFFLINE";
        if (/PERMISSION_DENIED|403/.test(message)) status = "FIREBASE READ DENIED";
        else if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/.test(message)) status = "ENABLE ANONYMOUS AUTH";
        else if (/API_KEY|PROJECT_NUMBER_MISMATCH/.test(message)) status = "FIREBASE AUTH ERROR";
        else if (/SENSOR_DATA_MISSING/.test(message)) status = "FIREBASE DATA MISSING";

        setText("dataSourceStatus", status);
        if (!state.firebaseDataLoaded) {
            [elements.ph, elements.turbidity, elements.moisture, elements.tank1, elements.tank2]
                .forEach((input) => { input.disabled = false; });
        }
    } finally {
        firebaseSyncRunning = false;
    }
}

updateDashboard();
updateWelcomeDate();
initializeProfileSettings();
initializeSensorCarousel();
initializePageSelector();
initializeAutomationSettings();
syncFirebaseSensors();
setInterval(syncFirebaseSensors, 2000);
updateClock();
setInterval(updateClock, 1000);
window.addEventListener("resize", updateDashboard);

console.info("ECOWAST interface initialized — simulation mode.");
