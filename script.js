/* =========================================================
   ECOWAST — DASHBOARD INTERACTION
   Firebase sensor dashboard and actuator controls.
========================================================= */

"use strict";

const $ = (id) => document.getElementById(id);

function initializeLogin() {
    const form = $("loginForm");
    const screen = $("loginScreen");
    const error = $("loginError");
    if (!form || !screen) return false;

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if ($("loginUsername").value.trim().toUpperCase() !== "PEDRO" || $("loginPassword").value !== "PEDRO123") {
            error.hidden = false;
            $("loginPassword").value = "";
            $("loginPassword").focus();
            return;
        }
        error.hidden = true;
        $("loginLock").classList.add("is-unlocked");
        $("dashboardLock")?.classList.add("is-unlocked");
        form.querySelector("button[type=submit]").disabled = true;
        $("operatorUsername").textContent = "PEDRO";
        window.setTimeout(() => {
            screen.hidden = true;
            initializeDashboard();
        }, 650);
    });
    return true;
}

function initializeDashboard() {
    updateDashboard();
    updateWelcomeDate();
    initializeProfileSettings();
    initializeSensorCarousel();
    initializePageSelector();
    initializeAutomationSettings();
    initializeManualSensorControls();
    initializeModeratorPumpControls();
    initializeModeratorAccess();
    syncFirebaseSensors();
    setInterval(syncFirebaseSensors, 2000);
    updateClock();
    setInterval(updateClock, 1000);
    window.addEventListener("resize", updateDashboard);
}

function initializeModeratorAccess() {
    const screen = $("moderatorScreen");
    const form = $("moderatorForm");
    const intro = $("moderatorIntro");
    const dashboard = $("moderatorDashboard");
    const error = $("moderatorError");
    if (!screen || !form || form.dataset.initialized) return;
    form.dataset.initialized = "true";
    let introTimer = 0;

    $("moderatorTrigger").addEventListener("click", () => {
        window.clearTimeout(introTimer);
        screen.hidden = false;
        form.hidden = false;
        intro.hidden = true;
        dashboard.hidden = true;
        error.hidden = true;
        $("moderatorPassword").value = "";
        window.setTimeout(() => $("moderatorPassword").focus(), 0);
    });
    const close = () => {
        window.clearTimeout(introTimer);
        screen.hidden = true;
    };
    $("moderatorCancel").addEventListener("click", close);
    $("moderatorBack").addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !screen.hidden) close();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if ($("moderatorPassword").value !== "DANIS") {
            error.hidden = false;
            $("moderatorPassword").value = "";
            $("moderatorPassword").focus();
            return;
        }
        error.hidden = true;
        form.hidden = true;
        intro.hidden = false;
        introTimer = window.setTimeout(() => {
            intro.hidden = true;
            dashboard.hidden = false;
        }, 1400);
    });
}

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
    manualSensorModes: {},
    manualSensorOverrides: {},
    originalSensorValues: {},
    reservoirFull: false,
    reservoirReadingAvailable: false,
    phIsRawAdc: false,
    turbidityIsRawAdc: false,
    ntuCleanMax: 10,
    ntuCloudyMax: 50,
    pumps: {
        pump1: false,
        pump2: false,
        pump3: false,
        pump4: false,
        uv: false
    }
};
state.irrigationActive = false;

const manualSensorFields = {
    ph: { inputId: "manualPh", min: 0, max: 14 },
    turbidity: { inputId: "manualTurbidity", min: 0, max: 500 },
    tank1: { inputId: "manualTank1", min: 0, max: 100 },
    tank2: { inputId: "manualTank2", min: 0, max: 100 },
    moisture: { inputId: "manualMoisture", min: 0, max: 100 },
    temperature: { inputId: "manualTemperature", min: 0, max: 50 },
    humidity: { inputId: "manualHumidity", min: 0, max: 100 }
};

function getDisplayedSensorValue(key) {
    if (["ph", "turbidity", "tank1", "tank2", "moisture"].includes(key)) return Number(elements[key].value);
    return Number($(key === "temperature" ? "temperatureValue" : "humidityValue").textContent);
}

function setDisplayedSensorValue(key, value) {
    if (["ph", "turbidity", "tank1", "tank2", "moisture"].includes(key)) {
        elements[key].value = String(value);
    } else {
        setText(key === "temperature" ? "temperatureValue" : "humidityValue", Number(value).toFixed(1));
    }
}

function randomizeManualSensorDecimals() {
    Object.keys(manualSensorFields).forEach((key) => {
        if (!state.manualSensorModes[key] || !Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, key)) return;
        const baseValue = Number(state.manualSensorOverrides[key]);
        if (!Number.isFinite(baseValue)) return;
        let randomizedValue;
        if (key === "turbidity") {
            const hundreds = Math.floor(baseValue / 100) * 100;
            const randomizedLastTwoDigits = Math.floor(Math.random() * 100);
            randomizedValue = Math.min(manualSensorFields[key].max, hundreds + randomizedLastTwoDigits);
        } else {
            randomizedValue = Math.trunc(baseValue) + Math.floor(Math.random() * 10) / 10;
        }
        setDisplayedSensorValue(key, randomizedValue);
        reportDanisSave(key, "manual", randomizedValue);
    });
    updateDashboard();
}

async function saveDanisSensorSetting(key, mode, value) {
    const token = await getFirebaseIdToken();
    const path = `${firebaseConfig.databaseURL}/ecowast/DANIS/${encodeURIComponent(key)}.json`;
    const body = JSON.stringify({ mode, value, updatedAt: Date.now() });
    try {
        return await firebaseJsonRequest(`${path}?auth=${encodeURIComponent(token)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body
        });
    } catch (error) {
        if (error.status !== 401) throw error;
        const refreshedToken = await getFirebaseIdToken(true);
        return firebaseJsonRequest(`${path}?auth=${encodeURIComponent(refreshedToken)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body
        });
    }
}

function getManualSensorValue(key) {
    return state.manualSensorModes[key] && Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, key)
        ? state.manualSensorOverrides[key]
        : getDisplayedSensorValue(key);
}

function reportDanisSave(key, mode, value) {
    saveDanisSensorSetting(key, mode, value).then(() => {
        $("manualSensorStatus").textContent = `Mode dan nilai ${key} tersimpan di Firebase/DANIS.`;
    }).catch((error) => {
        console.error(`ECOWAST failed to save DANIS/${key}:`, error);
        $("manualSensorStatus").textContent = `Gagal menyimpan ${key} ke Firebase/DANIS.`;
    });
}

function initializeManualSensorControls() {
    const grid = $("manualSensorGrid");
    if (!grid || grid.dataset.initialized) return;
    grid.dataset.initialized = "true";
    window.setInterval(randomizeManualSensorDecimals, 4000);
    Object.keys(manualSensorFields).forEach((key) => {
        state.originalSensorValues[key] = getDisplayedSensorValue(key);
    });

    const refreshRow = (key) => {
        const row = grid.querySelector(`[data-sensor-key="${key}"]`);
        const sourceSelect = row?.querySelector("[data-sensor-mode]");
        if (!row || !sourceSelect) return;
        const manual = state.manualSensorModes[key] === true;
        const input = $(manualSensorFields[key].inputId);
        const button = row.querySelector("[data-sensor-done]");
        sourceSelect.value = manual ? "manual" : "original";
        input.disabled = !manual;
        button.disabled = !manual;
        if (!manual || !input.value) {
            const value = Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, key)
                ? state.manualSensorOverrides[key]
                : getDisplayedSensorValue(key);
            input.value = Number.isFinite(value) ? String(value) : "";
        }
    };

    grid.querySelectorAll("[data-sensor-mode]").forEach((sourceSelect) => {
        const key = sourceSelect.dataset.sensorMode;
        state.manualSensorModes[key] = sourceSelect.value === "manual";
        sourceSelect.addEventListener("change", () => {
            const manual = sourceSelect.value === "manual";
            state.manualSensorModes[key] = manual;
            if (manual) {
                const input = $(manualSensorFields[key].inputId);
                const value = Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, key)
                    ? state.manualSensorOverrides[key]
                    : getDisplayedSensorValue(key);
                input.value = Number.isFinite(value) ? String(value) : "";
                $("manualSensorStatus").textContent = `Mode ISI MANUAL aktif untuk ${key}. Tekan DONE untuk menerapkan nilai.`;
            } else {
                delete state.manualSensorOverrides[key];
                const originalValue = state.originalSensorValues[key];
                if (Number.isFinite(originalValue)) setDisplayedSensorValue(key, originalValue);
                else if (key === "temperature" || key === "humidity") {
                    setText(key === "temperature" ? "temperatureValue" : "humidityValue", "--");
                }
                $("manualSensorStatus").textContent = `Mode NILAI ASLI aktif untuk ${key}.`;
            }
            refreshRow(key);
            updateDashboard();
            reportDanisSave(key, manual ? "manual" : "original", getManualSensorValue(key));
        });
        refreshRow(key);
    });

    grid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-sensor-done]");
        if (!button) return;
        const key = button.dataset.sensorDone;
        if (!state.manualSensorModes[key]) return;
        const field = manualSensorFields[key];
        const input = $(field.inputId);
        const value = Number(input.value);
        const maximum = key === "ph" && state.phIsRawAdc ? Math.max(4095, Number(elements.ph.max))
            : key === "turbidity" && state.turbidityIsRawAdc ? Math.max(4095, Number(elements.turbidity.max))
                : field.max;
        if (!input.value.trim() || !Number.isFinite(value) || value < field.min || value > maximum) {
            $("manualSensorStatus").textContent = `Nilai ${key} harus di antara ${field.min} dan ${maximum}.`;
            input.focus();
            return;
        }
        state.manualSensorOverrides[key] = value;
        setDisplayedSensorValue(key, value);
        input.value = String(value);
        updateDashboard();
        $("manualSensorStatus").textContent = `Nilai ${key} diterapkan.`;
        reportDanisSave(key, "manual", value);
    });
}

const moderatorPumpControls = [
    { key: "pump1", modeId: "transferMode", mirrorModeId: "moderatorTransferMode", mirrorPumpId: "moderatorPump1" },
    { key: "pump2", modeId: "refilterMode", mirrorModeId: "moderatorRefilterMode", mirrorPumpId: "moderatorPump2" },
    { key: "pump3", modeId: "reservoirMode", mirrorModeId: "moderatorReservoirMode", mirrorPumpId: "moderatorPump3" },
    { key: "pump4", modeId: "irrigationMode", mirrorModeId: "moderatorIrrigationMode", mirrorPumpId: "moderatorPump4" }
];

function syncModeratorPumpControls() {
    moderatorPumpControls.forEach(({ key, modeId, mirrorModeId, mirrorPumpId }) => {
        const sourceMode = $(modeId);
        const mirrorMode = $(mirrorModeId);
        const sourcePump = elements[key];
        const mirrorPump = $(mirrorPumpId);
        if (sourceMode && mirrorMode) mirrorMode.value = sourceMode.value;
        if (sourcePump && mirrorPump) {
            mirrorPump.textContent = sourcePump.textContent;
            mirrorPump.classList.toggle("active", sourcePump.classList.contains("active"));
            mirrorPump.disabled = sourcePump.disabled;
            mirrorPump.setAttribute("aria-pressed", sourcePump.getAttribute("aria-pressed") || "false");
        }
    });
}

function initializeModeratorPumpControls() {
    moderatorPumpControls.forEach(({ key, modeId, mirrorModeId, mirrorPumpId }) => {
        const sourceMode = $(modeId);
        const mirrorMode = $(mirrorModeId);
        const sourcePump = elements[key];
        if (!sourceMode || !mirrorMode || !sourcePump) return;
        mirrorMode.addEventListener("change", () => {
            sourceMode.value = mirrorMode.value;
            sourceMode.dispatchEvent(new Event("change", { bubbles: true }));
        });
        $(mirrorPumpId).addEventListener("click", () => sourcePump.click());
    });
    syncModeratorPumpControls();
}

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
    const phMax = 14;
    const ranges = {
        ph: [0, phMax],
        turbidity: [0, 500],
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
            : `<span>BERSIH: 0-${state.ntuCleanMax} NTU</span><span>KERUH: ${state.ntuCleanMax}-${state.ntuCloudyMax} NTU</span><span>KOTOR: &gt;${state.ntuCloudyMax} NTU</span>`;
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
    if (value >= 0 && value <= state.ntuCleanMax) return { label: "BERSIH", className: "state-good" };
    if (value <= state.ntuCloudyMax) return { label: "KERUH", className: "state-warning" };
    return { label: "KOTOR", className: "state-danger" };
}

function evaluateWater(data) {
    const quality = $("waterQuality");
    const cleanQualityStatus = $("cleanQualityStatus");
    if (state.turbidityIsRawAdc) {
        quality.textContent = "KALIBRASI NTU";
        setStateClass(quality, "state-warning");
        cleanQualityStatus.textContent = "SEDANG";
        setStateClass(cleanQualityStatus, "state-warning");
        return false;
    }

    // Demonstration thresholds only. Not a drinking-water certification.
    const passed = data.turbidity >= 0 && data.turbidity <= state.ntuCleanMax;
    const moderate = data.turbidity > state.ntuCleanMax && data.turbidity <= state.ntuCloudyMax;
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
        phCondition.textContent = data.ph.toFixed(1);
        setStateClass(phCondition, "state-good");
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
        plantScene.dataset.watering = state.irrigationActive ? "on" : "off";
        plantScene.setAttribute("aria-label", `${state.irrigationActive ? "Tanaman sedang disirami" : (plantScene.dataset.condition === "dry" ? "Tanaman kering" : "Tanaman segar")}${uvActive ? ", disinari lampu UV" : ""}`);
    }
    setText("plantCondition", state.irrigationActive
        ? "TANAMAN SEDANG DISIRAM"
        : (plantScene?.dataset.condition === "dry" ? "TANAMAN KERING" : "TANAMAN SEGAR"));
    setText("uvStatus", uvActive ? "UV ON" : "UV OFF");
    if (elements.uv) elements.uv.setAttribute("aria-label", uvActive ? "Matikan lampu UV" : "Nyalakan lampu UV");
    const modeMap = { pump1: "transferMode", pump2: "refilterMode", pump3: "reservoirMode", pump4: "irrigationMode", uv: "uvMode" };
    Object.entries(modeMap).forEach(([key, id]) => {
        if (elements[key]) elements[key].disabled = ($(id)?.value || "MANUAL") === "AUTO";
    });
    const mode = $("gardenMode")?.value || "AUTO";
    const sensorFields = $("gardenSensorFields");
    const scheduleFields = $("gardenScheduleFields");
    if (sensorFields) sensorFields.hidden = mode !== "AUTO";
    if (scheduleFields) scheduleFields.hidden = mode !== "MANUAL";
    ["moistureOnThreshold", "moistureOffThreshold"].forEach((id) => {
        const input = $(id);
        if (input) input.disabled = mode !== "AUTO";
    });
    document.querySelectorAll("#gardenScheduleList .schedule-start, #gardenScheduleList .schedule-duration")
        .forEach((input) => { input.disabled = mode !== "MANUAL"; });
    syncModeratorPumpControls();
    syncModeratorMonitor();
}

function syncModeratorMonitor() {
    const copy = (targetId, sourceId, suffix = "") => {
        const target = $(targetId);
        const source = $(sourceId);
        if (target && source) target.textContent = `${source.textContent.trim()}${suffix}`;
    };
    copy("modPh", "dataPhValue", ` ${$("dataPhUnit")?.textContent || "pH"}`);
    copy("modTurbidity", "dataTurbidityValue", ` ${$("dataTurbidityUnit")?.textContent || "NTU"}`);
    copy("modWaterQuality", "waterQuality");
    copy("modPhCondition", "phCondition");
    copy("modTurbidityState", "filterTurbidityState");
    copy("modFlowMode", "flowMode");
    copy("modFilterRecommendation", "filterRecommendation");
    copy("modFilterStatus", "cleanQualityStatus");
    copy("modTank1", "tank1Value");
    copy("modTank2", "tank2Value");
    copy("modReservoir", "reservoirStatus");
    copy("modReservoirPump", "reservoirPumpState");
    copy("modMoisture", "moistureValue");
    copy("modPlant", "plantCondition");
    copy("modTemperature", "temperatureValue", " C");
    copy("modHumidity", "humidityValue", " %");
    copy("modCapacity", "dataCapacityStatus");
    copy("modDataSource", "dataSourceStatus");
    copy("modPump1", "pump1");
    copy("modPump2", "pump2");
    copy("modPump3", "pump3");
    copy("modPump4", "pump4");
    copy("modUv", "uvStatus");
    ["transferMode", "refilterMode", "reservoirMode", "irrigationMode", "gardenMode", "uvMode"]
        .forEach((id) => {
            const value = $(id)?.value;
            const target = $(`mod${id[0].toUpperCase()}${id.slice(1)}`);
            if (target && value) target.textContent = value;
        });
    copy("modSystemStatus", "systemStatus");
}

function updateDashboard() {
    const data = readSensors();
    const currentValues = {
        ph: data.ph,
        turbidity: data.turbidity,
        tank1: data.tank1,
        tank2: data.tank2,
        moisture: data.moisture,
        temperature: Number($("temperatureValue").textContent),
        humidity: Number($("humidityValue").textContent)
    };
    Object.entries(currentValues).forEach(([key, value]) => {
        if (!state.manualSensorModes[key] && Number.isFinite(value)) {
            state.originalSensorValues[key] = value;
            const editor = $(manualSensorFields[key]?.inputId);
            if (editor) editor.value = String(value);
        }
    });

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
    syncModeratorMonitor();
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
    scene.dataset.watering = state.irrigationActive ? "on" : "off";
    scene.setAttribute("aria-label", state.irrigationActive ? "Tanaman sedang disirami" : (isDry ? "Tanaman kering" : "Tanaman segar"));
    condition.textContent = state.irrigationActive ? "TANAMAN SEDANG DISIRAM" : (isDry ? "TANAMAN KERING" : "TANAMAN SEGAR");
    reading.textContent = `Kelembaban tanah ${moisture}%`;
}

let firebaseControlWriteQueue = Promise.resolve();
const pendingPumpWrites = new Map();
const recentPumpWrites = new Map();
let gardenSettingsDirty = false;
let lastManualScheduleRelayState = null;
let recentGardenModeWriteAt = 0;
let recentIrrigationScheduleWriteAt = 0;
let activeGardenSchedule = null;

function getScheduleValues(listId) {
    return Array.from($(listId).querySelectorAll("[data-schedule-row]")).map((row) => ({
        startTime: row.querySelector(".schedule-start").value,
        durationSeconds: Number(row.querySelector(".schedule-duration").value)
    }));
}

function createScheduleRow(listId, index) {
    const row = document.createElement("div");
    row.className = "schedule-row";
    row.dataset.scheduleRow = "";
    const times = document.createElement("div");
    times.className = "schedule-time-grid";
    [["Mulai siram", "07:00", "schedule-start", "time"],
        ["Durasi siram (detik)", "10", "schedule-duration", "number"]].forEach(([caption, value, className, type]) => {
        const label = document.createElement("label");
        label.textContent = caption;
        const input = document.createElement("input");
        input.type = type;
        input.value = value;
        if (type === "number") { input.min = "1"; input.max = "86400"; input.step = "1"; }
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
        const durationInput = row.querySelector(".schedule-duration");
        const legacyStop = schedule.stopTime;
        let duration = Number(schedule.durationSeconds);
        if (!(duration > 0) && legacyStop) {
            const [startHour, startMinute] = (schedule.startTime || fallback.startTime).split(":").map(Number);
            const [stopHour, stopMinute] = legacyStop.split(":").map(Number);
            duration = (((stopHour * 60 + stopMinute) - (startHour * 60 + startMinute) + 1440) % 1440) * 60;
        }
        durationInput.value = duration > 0 ? String(Math.min(86400, duration)) : String(schedule.durationSeconds || fallback.durationSeconds || 10);
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

async function syncManualIrrigationSchedule() {
    if ($("gardenMode")?.value !== "MANUAL") return;
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date());
    const part = (name) => Number(parts.find(({ type }) => type === name)?.value || 0);
    const nowSeconds = part("hour") * 3600 + part("minute") * 60 + part("second");
    const active = (activeGardenSchedule || getScheduleValues("gardenScheduleList")).some(({ startTime, durationSeconds }) => {
        const [startHour, startMinute] = startTime.split(":").map(Number);
        const startSeconds = startHour * 3600 + startMinute * 60;
        const duration = Number(durationSeconds);
        if (!(duration > 0)) return false;
        return [0, 86400].some((offset) => {
            const elapsed = nowSeconds - (startSeconds - offset);
            return elapsed >= 0 && elapsed < duration;
        });
    });
    if (active === lastManualScheduleRelayState) return;

    lastManualScheduleRelayState = active;
    state.irrigationActive = active || state.pumps.pump4;
    recentIrrigationScheduleWriteAt = Date.now();
    updateDashboard();
    try {
        await queueFirebaseControlWrite({ relaymodepompa: active });
    } catch (error) {
        lastManualScheduleRelayState = null;
        setText("dataSourceStatus", "CONTROL WRITE FAILED");
        console.error("ECOWAST failed to update scheduled irrigation relay:", error);
    }
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
    const modeIds = { pump1: "transferMode", pump2: "refilterMode", pump3: "reservoirMode", pump4: "irrigationMode", uv: "uvMode" };
    if ($(modeIds[key])?.value === "AUTO") return;
    const previousValue = state.pumps[key];
    const nextValue = !previousValue;
    state.pumps[key] = nextValue;
    if (key === "pump4") state.irrigationActive = nextValue || (state.irrigationActive && $("gardenMode")?.value === "MANUAL");
    pendingPumpWrites.set(key, nextValue);
    updateDashboard();

    const firebasePumpKey = key === "pump2" ? "pump3" : key === "pump3" ? "pump2" : key;
    const controlPatch = { [firebasePumpKey]: nextValue, pump5: null };
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
    const gardenForm = $("gardenSettingsForm");
    const gardenMode = $("gardenMode");
    if (!gardenForm || !gardenMode) return;

    const actuatorModes = {
        transferMode: "transfermode", refilterMode: "refiltermode", reservoirMode: "reservoirmode",
        irrigationMode: "irrigationmode", uvMode: "uvmode"
    };
    Object.entries(actuatorModes).forEach(([id, firebaseKey]) => {
        const select = $(id);
        if (!select) return;
        select.addEventListener("change", async () => {
            updatePumpButtons();
            try {
                await queueFirebaseControlWrite({ [firebaseKey]: select.value });
            } catch (error) {
                setText("dataSourceStatus", "CONTROL WRITE FAILED");
                console.error(`ECOWAST failed to save ${firebaseKey}:`, error);
            }
        });
    });
    gardenMode.addEventListener("change", async () => {
        gardenSettingsDirty = true;
        if (gardenMode.value === "AUTO") state.irrigationActive = state.pumps.pump4;
        updatePumpButtons();
        try {
            await queueFirebaseControlWrite({ tanamanmode: gardenMode.value });
            recentGardenModeWriteAt = Date.now();
            if (gardenMode.value === "MANUAL") {
                lastManualScheduleRelayState = null;
                await syncManualIrrigationSchedule();
            } else {
                lastManualScheduleRelayState = null;
            }
        } catch (error) {
            setText("dataSourceStatus", "CONTROL WRITE FAILED");
            console.error("ECOWAST failed to save tanamanmode:", error);
        }
    });
    gardenForm.addEventListener("input", () => { gardenSettingsDirty = true; });
    gardenForm.addEventListener("change", () => {
        gardenSettingsDirty = true;
        updatePumpButtons();
    });
    initializeScheduleList("gardenScheduleList", () => {
        gardenSettingsDirty = true;
        updatePumpButtons();
    });
    try {
        const savedSchedule = JSON.parse(localStorage.getItem("ecowastGardenSchedule") || "null");
        if (Array.isArray(savedSchedule) && savedSchedule.length) {
            setScheduleValues("gardenScheduleList", savedSchedule, { startTime: "07:00", durationSeconds: 10 });
        }
    } catch (error) {
        console.warn("ECOWAST could not load the saved watering schedule:", error);
    }
    activeGardenSchedule = getScheduleValues("gardenScheduleList");

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
        if (gardenMode.value === "MANUAL" && schedules.some(({ durationSeconds }) => !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400)) {
            setText("gardenSettingsStatus", "Durasi siram harus antara 1 sampai 86400 detik.");
            return;
        }

        setText("gardenSettingsStatus", "Menyimpan pengaturan...");
        if (button) button.disabled = true;
        try {
            localStorage.setItem("ecowastGardenSchedule", JSON.stringify(schedules));
            activeGardenSchedule = schedules;
            await queueFirebaseControlWrite({
                tanamanmode: gardenMode.value,
                gardenSensor: { moistureOnBelow, moistureOffAbove }
            });
            recentGardenModeWriteAt = Date.now();
            gardenSettingsDirty = false;
            setText("gardenSettingsStatus", "Mode dikirim ke Firebase; jadwal tersimpan di browser ini.");
            if (gardenMode.value === "MANUAL") {
                lastManualScheduleRelayState = null;
                await syncManualIrrigationSchedule();
            }
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

setInterval(syncManualIrrigationSchedule, 1000);

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
    let tankSettingsLoaded = false;
    let ntuSettingsLoaded = false;
    const tankSettingFields = [
        ["tank1FullSetting", "TANKI 1 FULL"],
        ["tank1EmptySetting", "TANKI 1 KOSONG"],
        ["tank2FullSetting", "TANKI 2 FULL"],
        ["tank2EmptySetting", "TANKI 2 KOSONG"]
    ];

    async function loadTankSettings() {
        if (tankSettingsLoaded) return;
        const status = $("tankSettingsStatus");
        status.textContent = "Memuat pengaturan...";
        const path = `${firebaseConfig.databaseURL}/ecowast/${encodeURIComponent("TANKI SETTING")}.json`;
        try {
            let settings;
            try {
                settings = await firebaseJsonRequest(`${path}?auth=${encodeURIComponent(await getFirebaseIdToken())}`);
            } catch (error) {
                if (error.status !== 401) throw error;
                settings = await firebaseJsonRequest(`${path}?auth=${encodeURIComponent(await getFirebaseIdToken(true))}`);
            }
            if (settings && typeof settings === "object") {
                tankSettingFields.forEach(([id, key]) => {
                    if (settings[key] !== undefined && Number.isFinite(Number(settings[key]))) $(id).value = settings[key];
                });
            }
            tankSettingsLoaded = true;
            status.textContent = settings ? "Pengaturan Firebase dimuat." : "Isi nilai lalu tekan KIRIM.";
        } catch (error) {
            status.textContent = "Gagal memuat. Isi nilai lalu tekan KIRIM.";
        }
    }

    async function loadNtuSettings() {
        if (ntuSettingsLoaded) return;
        const status = $("ntuSettingsStatus");
        status.textContent = "Memuat pengaturan...";
        const path = `${firebaseConfig.databaseURL}/ecowast/${encodeURIComponent("NTU SETTING")}.json`;
        try {
            let settings;
            try {
                settings = await firebaseJsonRequest(`${path}?auth=${encodeURIComponent(await getFirebaseIdToken())}`);
            } catch (error) {
                if (error.status !== 401) throw error;
                settings = await firebaseJsonRequest(`${path}?auth=${encodeURIComponent(await getFirebaseIdToken(true))}`);
            }
            if (settings && typeof settings === "object") {
                const clean = Number(settings["NTU BERSIH"] ?? settings["NTU AIR BERSIH MAX"]);
                const cloudy = Number(settings["NTU KERUH"] ?? 50);
                if (Number.isFinite(clean) && Number.isFinite(cloudy)) {
                    state.ntuCleanMax = clean;
                    state.ntuCloudyMax = cloudy;
                    $("ntuCleanSetting").value = String(clean);
                    $("ntuCloudySetting").value = String(cloudy);
                    updateDashboard();
                }
            }
            ntuSettingsLoaded = true;
            status.textContent = settings ? "Pengaturan Firebase dimuat." : "Isi batas NTU lalu tekan KIRIM.";
        } catch (error) {
            status.textContent = "Gagal memuat. Isi batas NTU lalu tekan KIRIM.";
        }
    }

    settingsToggle.addEventListener("click", () => {
        const open = settingsPanel.hidden;
        settingsPanel.hidden = !open;
        settingsToggle.setAttribute("aria-expanded", String(open));
        if (open) usernameInput.focus();
        if (open) loadTankSettings();
        if (open) loadNtuSettings();
    });

    $("sendTankSettings").addEventListener("click", async () => {
        const status = $("tankSettingsStatus");
        const values = {};
        for (const [id, key] of tankSettingFields) {
            const input = $(id);
            if (input.value.trim() === "" || !Number.isFinite(input.valueAsNumber) || input.valueAsNumber < 0) {
                status.textContent = `Masukkan nilai ${key} yang valid.`;
                input.focus();
                return;
            }
            values[key] = input.valueAsNumber;
        }

        status.textContent = "Mengirim ke Firebase...";
        const path = `${firebaseConfig.databaseURL}/ecowast/${encodeURIComponent("TANKI SETTING")}.json`;
        const send = (token) => firebaseJsonRequest(`${path}?auth=${encodeURIComponent(token)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values)
        });
        try {
            try {
                await send(await getFirebaseIdToken());
            } catch (error) {
                if (error.status !== 401) throw error;
                await send(await getFirebaseIdToken(true));
            }
            tankSettingsLoaded = true;
            status.textContent = "Pengaturan berhasil dikirim ke Firebase.";
        } catch (error) {
            status.textContent = `Gagal mengirim: ${error.message || "periksa koneksi Firebase"}`;
        }
    });

    $("sendNtuSettings").addEventListener("click", async () => {
        const status = $("ntuSettingsStatus");
        const clean = $("ntuCleanSetting").valueAsNumber;
        const cloudy = $("ntuCloudySetting").valueAsNumber;
        if (!Number.isFinite(clean) || !Number.isFinite(cloudy)) {
            status.textContent = "Masukkan nilai angka yang valid untuk kedua pengaturan NTU.";
            return;
        }

        const values = { "NTU BERSIH": clean, "NTU KERUH": cloudy };
        const path = `${firebaseConfig.databaseURL}/ecowast/${encodeURIComponent("NTU SETTING")}.json`;
        const send = (token) => firebaseJsonRequest(`${path}?auth=${encodeURIComponent(token)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values)
        });
        status.textContent = "Mengirim ke Firebase...";
        try {
            try {
                await send(await getFirebaseIdToken());
            } catch (error) {
                if (error.status !== 401) throw error;
                await send(await getFirebaseIdToken(true));
            }
            state.ntuCleanMax = clean;
            state.ntuCloudyMax = cloudy;
            ntuSettingsLoaded = true;
            updateDashboard();
            status.textContent = "NTU SETTING berhasil dikirim ke Firebase.";
        } catch (error) {
            status.textContent = `Gagal mengirim: ${error.message || "periksa koneksi Firebase"}`;
        }
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
    // ESP32 publishes the current schema under monitoring.*. Flatten it into
    // the dashboard's existing sensor fields while keeping legacy fields supported.
    const monitoring = sensorData.monitoring && typeof sensorData.monitoring === "object"
        ? sensorData.monitoring
        : (statusData?.monitoring && typeof statusData.monitoring === "object" ? statusData.monitoring : {});
    const dht = monitoring.dht && typeof monitoring.dht === "object" ? monitoring.dht : {};
    const ph = monitoring.ph && typeof monitoring.ph === "object" ? monitoring.ph : {};
    const turbidity = monitoring.turbidity && typeof monitoring.turbidity === "object" ? monitoring.turbidity : {};
    const soil = monitoring.soil && typeof monitoring.soil === "object" ? monitoring.soil : {};
    const ultrasonic1 = monitoring.ultrasonic1 && typeof monitoring.ultrasonic1 === "object" ? monitoring.ultrasonic1 : {};
    const ultrasonic2 = monitoring.ultrasonic2 && typeof monitoring.ultrasonic2 === "object" ? monitoring.ultrasonic2 : {};
    const water = monitoring.water && typeof monitoring.water === "object" ? monitoring.water : {};
    sensorData = {
        ...sensorData,
        ...(ph.value !== undefined ? { ph: ph.value } : {}),
        ...(sensorData.turbidity === undefined && turbidity.ntu !== undefined ? { turbidity: turbidity.ntu } : {}),
        ...(sensorData.soilMoisture === undefined && soil.percent !== undefined ? { soilMoisture: soil.percent } : {}),
        ...(sensorData.tank1Level === undefined && ultrasonic1.percent !== undefined ? { tank1Level: ultrasonic1.percent } : {}),
        ...(sensorData.tank2Level === undefined && ultrasonic2.percent !== undefined ? { tank2Level: ultrasonic2.percent } : {}),
        ...(sensorData.water === undefined && water.detected !== undefined ? { water: water.detected } : {}),
        ...(sensorData.dht11 === undefined && Object.keys(dht).length ? { dht11: dht } : {})
    };
    state.phIsRawAdc = false;
    state.turbidityIsRawAdc = sensorData.turbidity === undefined && sensorData.turbidityRaw !== undefined;
    let reservoirSignal = sensorData.reservoirFull ?? sensorData.tandonFull ?? sensorData.waterLevelFull ?? sensorData.waterLevelCable ?? sensorData.cableWaterLevel ?? sensorData.waterLevelSensor ?? sensorData.waterLevel ?? sensorData.water_level ?? sensorData.water;
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
        ["ph", "ph"],
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
            : inputKey === "turbidity" ? 500
                    : 100;
        const clampedValue = Math.min(maxValue, Math.max(0, value));
        state.originalSensorValues[inputKey] = clampedValue;
        input.max = String(maxValue);
        const effectiveValue = state.manualSensorModes[inputKey] && Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, inputKey)
            ? state.manualSensorOverrides[inputKey]
            : clampedValue;
        input.value = String(effectiveValue);
        input.disabled = true;
        updated++;
    });

    const dhtData = sensorData.dht11 && typeof sensorData.dht11 === "object" ? sensorData.dht11 : sensorData;
    const temperature = Number(dhtData.temperature ?? dhtData.temp);
    const humidity = Number(statusData?.humidity ?? dhtData.humidity ?? dhtData.hum);
    const hasTemperature = Number.isFinite(temperature) && temperature >= 0;
    const hasHumidity = Number.isFinite(humidity) && humidity >= 0 && statusData?.dhtValid !== 0 && dhtData.valid !== false;
    const hasValidTemperature = hasTemperature && dhtData.valid !== false;
    if (hasValidTemperature) {
        state.originalSensorValues.temperature = temperature;
        const effectiveTemperature = state.manualSensorModes.temperature && Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, "temperature")
            ? state.manualSensorOverrides.temperature : temperature;
        setText("temperatureValue", effectiveTemperature.toFixed(1));
    }
    if (hasHumidity) {
        state.originalSensorValues.humidity = humidity;
        const effectiveHumidity = state.manualSensorModes.humidity && Object.prototype.hasOwnProperty.call(state.manualSensorOverrides, "humidity")
            ? state.manualSensorOverrides.humidity : humidity;
        setText("humidityValue", effectiveHumidity.toFixed(1));
    }
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
    const firebaseKeys = { pump1: "pump1", pump2: "pump3", pump3: "pump2", pump4: "pump4", uv: "uv" };
    Object.entries(firebaseKeys).forEach(([stateKey, firebaseKey]) => {
        const value = controlData[firebaseKey];
        const recentWriteAt = recentPumpWrites.get(stateKey) || 0;
        if (pendingPumpWrites.has(stateKey) || Date.now() - recentWriteAt < 5000) return;
        if (value === true || value === false || value === 0 || value === 1 || value === "0" || value === "1") {
            state.pumps[stateKey] = value === true || Number(value) === 1;
        }
    });

    const actuatorModes = { transfermode: "transferMode", refiltermode: "refilterMode", reservoirmode: "reservoirMode", irrigationmode: "irrigationMode", uvmode: "uvMode" };
    Object.entries(actuatorModes).forEach(([firebaseKey, id]) => {
        const value = controlData[firebaseKey];
        if (value === "AUTO" || value === "MANUAL") $(id).value = value;
    });
    if (Date.now() - recentGardenModeWriteAt >= 5000 && (controlData.tanamanmode === "AUTO" || controlData.tanamanmode === "MANUAL")) {
        $("gardenMode").value = controlData.tanamanmode;
    }
    const relayCommandActive = (value) => value === true || value === 1 || value === "1";
    if (Date.now() - recentIrrigationScheduleWriteAt >= 5000) {
        const pumpRelayActive = relayCommandActive(controlData.pump4);
        const scheduledRelayActive = relayCommandActive(controlData.relaymodepompa);
        state.irrigationActive = pumpRelayActive || ($("gardenMode").value === "MANUAL" && scheduledRelayActive);
    }

    if (!gardenSettingsDirty && !$("gardenSettingsForm").contains(document.activeElement)) {
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
        let monitoringData = null;
        try {
            monitoringData = await firebaseJsonRequest(
                `${firebaseConfig.databaseURL}/ecowast/monitoring.json?auth=${encodeURIComponent(firebaseIdToken || token)}`,
                { cache: "no-store" }
            );
        } catch (error) {
            if (error.status === 401) {
                try {
                    const refreshedToken = await getFirebaseIdToken(true);
                    monitoringData = await firebaseJsonRequest(
                        `${firebaseConfig.databaseURL}/ecowast/monitoring.json?auth=${encodeURIComponent(refreshedToken)}`,
                        { cache: "no-store" }
                    );
                } catch (_) {
                    monitoringData = null;
                }
            }
        }
        applyFirebaseControlData({
            ...(statusData && typeof statusData === "object" ? statusData : {}),
            ...(controlData && typeof controlData === "object" ? controlData : {})
        });
        // The current firmware publishes live sensor fields under /status.
        // Merge it over /sensor so the newest firmware schema takes priority.
        const liveSensorData = statusData && typeof statusData === "object"
            ? { ...(sensorData && typeof sensorData === "object" ? sensorData : {}), ...statusData }
            : (sensorData && typeof sensorData === "object" ? sensorData : {});
        if (monitoringData && typeof monitoringData === "object") liveSensorData.monitoring = monitoringData;
        applyFirebaseSensorData(liveSensorData, statusData);
    } catch (error) {
        const message = String(error.message || "").toUpperCase();
        let status = "FIREBASE OFFLINE";
        if (/PERMISSION_DENIED|403/.test(message)) status = "FIREBASE READ DENIED";
        else if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/.test(message)) status = "ENABLE ANONYMOUS AUTH";
        else if (/API_KEY|PROJECT_NUMBER_MISMATCH/.test(message)) status = "FIREBASE AUTH ERROR";
        else if (/SENSOR_DATA_MISSING/.test(message)) status = "FIREBASE DATA MISSING";

        setText("dataSourceStatus", status);
        syncModeratorMonitor();
        if (!state.firebaseDataLoaded) {
            [elements.ph, elements.turbidity, elements.moisture, elements.tank1, elements.tank2]
                .forEach((input) => { input.disabled = false; });
        }
    } finally {
        firebaseSyncRunning = false;
    }
}

if (!initializeLogin()) initializeDashboard();
