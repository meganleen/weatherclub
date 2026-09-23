const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const STORAGE_KEY = "weatherclub";

// WMO weather interpretation codes used by Open-Meteo.
const WEATHER_LABELS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Icy fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail",
};

// How hard it's coming down, used to scale the rain/snow animation.
const INTENSITY = {
  51: 0.3, 53: 0.45, 55: 0.6, 56: 0.4, 57: 0.6,
  61: 0.6, 63: 1, 65: 1.5, 66: 0.6, 67: 1.2,
  71: 0.6, 73: 1, 75: 1.6, 77: 0.5,
  80: 0.6, 81: 1, 82: 1.6, 85: 0.7, 86: 1.4,
  95: 1.3, 96: 1.4, 99: 1.6,
};

const $ = (id) => document.getElementById(id);
const form = $("search-form");
const input = $("city-input");
const searchBtn = form.querySelector(".search-btn");
const suggestionsEl = $("suggestions");
const statusEl = $("status");
const welcomeEl = $("welcome");
const weatherEl = $("weather");
const locateBtn = $("locate-btn");

const state = {
  unit: "celsius",
  place: null,
  requestId: 0,
  suggestions: [],
  activeIndex: -1,
};

/* ---------- Helpers ---------- */

function conditionFor(code) {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

function labelFor(code) {
  return WEATHER_LABELS[code] || "Unknown";
}

function deg(value) {
  return `${Math.round(value)}°`;
}

// Open-Meteo returns local times like "2026-09-23T06:52" when timezone=auto,
// so read the clock straight from the string instead of going through Date.
function formatClock(iso) {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function formatHour(iso) {
  const h = Number(iso.slice(11, 13));
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
}

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" });
}

function cityNow(offsetSeconds) {
  return new Date(Date.now() + offsetSeconds * 1000).toLocaleString("en", {
    timeZone: "UTC",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function flag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "";
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

function regionOf(place) {
  const parts = [place.admin1, place.country].filter((part) => part && part !== place.name);
  return [...new Set(parts)].join(", ");
}

function compassPoint(degrees) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- Animated SVG icons ---------- */

const CLOUD_PATH = "M20 46a10 10 0 0 1-.6-19.98A14 14 0 0 1 46 24a11 11 0 0 1 0 22Z";
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return `<line x1="${32 + c * 17}" y1="${32 + s * 17}" x2="${32 + c * 23}" y2="${32 + s * 23}"/>`;
}).join("");

const sun = () =>
  `<g class="rays" stroke="#FFCF4A" stroke-width="3" stroke-linecap="round">${RAYS}</g>` +
  `<circle cx="32" cy="32" r="11" fill="#FFCF4A"/><circle cx="32" cy="32" r="11" fill="none" stroke="#FFE08A" stroke-width="1.5"/>`;

const moon = () =>
  `<path d="M53.4 33.7A21.6 21.6 0 1 1 29.9 10.2 16.8 16.8 0 0 0 53.4 33.7z" fill="#F5E9C4"/>` +
  `<path class="twinkle" d="M50 9l1.3 3.2 3.2 1.3-3.2 1.3L50 18l-1.3-3.2-3.2-1.3 3.2-1.3z" fill="#FFF6D8"/>`;

const cloud = (fill = "#F4F7FB") => `<path class="cloud-body" d="${CLOUD_PATH}" fill="${fill}"/>`;

const lines = (cls, xs, y1, y2, color, width, stagger) =>
  xs
    .map(
      (x, i) =>
        `<line class="${cls}" x1="${x}" y1="${y1}" x2="${x - 2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" style="animation-delay:${(-i * stagger).toFixed(2)}s"/>`
    )
    .join("");

function iconSvg(code, isDay = true) {
  const kind = conditionFor(code);
  let body;
  switch (kind) {
    case "clear":
      body = isDay ? sun() : moon();
      break;
    case "partly":
      body =
        `<g transform="translate(-6 -8) scale(.85)">${isDay ? sun() : moon()}</g>` +
        `<g transform="translate(8 8) scale(.9)">${cloud()}</g>`;
      break;
    case "cloudy":
      body =
        `<g transform="translate(14 -4) scale(.7)" opacity=".7">${cloud("#DDE4EC")}</g>` +
        `<g transform="translate(-2 4)">${cloud()}</g>`;
      break;
    case "fog":
      body =
        `<g transform="translate(0 -8)">${cloud("#E6EBF1")}</g>` +
        [44, 51, 58]
          .map(
            (y, i) =>
              `<line class="fogline" x1="${14 + i * 3}" y1="${y}" x2="${50 - i * 3}" y2="${y}" stroke="#E6EBF1" stroke-width="3.5" stroke-linecap="round" style="animation-delay:${-i * 1.2}s"/>`
          )
          .join("");
      break;
    case "drizzle":
      body = `<g transform="translate(0 -8)">${cloud("#E8EEF5")}</g>` + lines("drop", [24, 34, 44], 44, 49, "#8FD0FF", 2.5, 0.35);
      break;
    case "rain":
      body = `<g transform="translate(0 -8)">${cloud("#DCE4EE")}</g>` + lines("drop", [21, 29, 37, 45], 44, 52, "#6FC0FF", 3, 0.28);
      break;
    case "snow":
      body =
        `<g transform="translate(0 -8)">${cloud("#F4F7FB")}</g>` +
        [22, 32, 42, 27, 37]
          .map(
            (x, i) =>
              `<circle class="flake" cx="${x}" cy="${i < 3 ? 47 : 55}" r="2.6" fill="#FFFFFF" style="animation-delay:${(-i * 0.5).toFixed(1)}s"/>`
          )
          .join("");
      break;
    case "storm":
      body =
        `<g transform="translate(0 -8)">${cloud("#9DA8B7")}</g>` +
        lines("drop", [20, 46], 44, 51, "#6FC0FF", 3, 0.5) +
        `<path class="bolt" d="M35 36 27 50h6l-3 12 11-16h-6l4-10z" fill="#FFD43B" stroke="#FFB800" stroke-width="1" stroke-linejoin="round"/>`;
      break;
  }
  return `<svg class="wx" viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
}

/* ---------- Background particles (rain, snow, stars, lightning) ---------- */

const sky = (() => {
  const canvas = $("particles");
  const ctx = canvas.getContext("2d");
  const flashEl = document.querySelector(".flash");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0;
  let height = 0;
  let kind = "none";
  let density = 0;
  let stormy = false;
  let particles = [];
  let frame = 0;
  let flashTimer = 0;

  function create(anywhere) {
    const x = Math.random() * (width + 100);
    const y = anywhere ? Math.random() * height : -30;
    if (kind === "rain") {
      return { x, y, len: 12 + Math.random() * 14, speed: 13 + Math.random() * 9, alpha: 0.2 + Math.random() * 0.35 };
    }
    if (kind === "snow") {
      return { x, y, r: 1 + Math.random() * 2.6, speed: 0.5 + Math.random() * 1.1, phase: Math.random() * 6.3, alpha: 0.5 + Math.random() * 0.5 };
    }
    return { x: Math.random() * width, y: Math.random() * height * 0.75, r: 0.4 + Math.random() * 1.2, phase: Math.random() * 6.3, speed: 0.5 + Math.random() * 1.5 };
  }

  function spawn() {
    const perPixel = { rain: 1 / 9000, snow: 1 / 12000, stars: 1 / 7000 }[kind] || 0;
    const count = Math.min(Math.round(width * height * perPixel * density), 600);
    particles = Array.from({ length: count }, () => create(true));
  }

  function draw(t) {
    ctx.clearRect(0, 0, width, height);
    if (kind === "rain") {
      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      for (const p of particles) {
        ctx.strokeStyle = `rgba(200, 222, 245, ${p.alpha})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * 0.2, p.y + p.len);
        ctx.stroke();
      }
    } else if (kind === "snow" || kind === "stars") {
      for (const p of particles) {
        const alpha = kind === "stars" ? 0.3 + 0.7 * Math.abs(Math.sin(t * 0.001 * p.speed + p.phase)) : p.alpha;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function update(t) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (kind === "rain") {
        p.y += p.speed;
        p.x -= p.speed * 0.2;
      } else if (kind === "snow") {
        p.y += p.speed;
        p.x += Math.sin(t * 0.001 + p.phase) * 0.5;
      }
      if (p.y > height + 30 || p.x < -30) particles[i] = create(false);
    }
  }

  function step(t) {
    update(t);
    draw(t);
    frame = requestAnimationFrame(step);
  }

  function flash() {
    flashTimer = setTimeout(() => {
      flashEl.classList.remove("on");
      void flashEl.offsetWidth; // restart the CSS animation
      flashEl.classList.add("on");
      flash();
    }, 4000 + Math.random() * 7000);
  }

  function start() {
    cancelAnimationFrame(frame);
    clearTimeout(flashTimer);
    flashEl.classList.remove("on");
    spawn();
    if (reducedMotion.matches || kind === "none") {
      draw(0);
      return;
    }
    frame = requestAnimationFrame(step);
    if (stormy) flash();
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    start();
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  reducedMotion.addEventListener?.("change", start);

  return {
    init: resize,
    set(newKind, newDensity = 1, storm = false) {
      kind = newKind;
      density = newDensity;
      stormy = storm;
      start();
    },
  };
})();

function applySky(code, isDay) {
  const condition = conditionFor(code);
  const skyTheme = condition === "drizzle" ? "rain" : condition;
  document.body.dataset.sky = skyTheme;
  document.body.dataset.time = isDay ? "day" : "night";

  const intensity = INTENSITY[code] || 1;
  if (condition === "rain" || condition === "drizzle") sky.set("rain", intensity);
  else if (condition === "storm") sky.set("rain", intensity, true);
  else if (condition === "snow") sky.set("snow", intensity);
  else if (!isDay && condition === "clear") sky.set("stars", 1);
  else if (!isDay && condition === "partly") sky.set("stars", 0.5);
  else sky.set("none");
}

/* ---------- Data ---------- */

async function getJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("Couldn't reach the weather service. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new Error(`The weather service returned an error (${response.status}). Please try again.`);
  }
  return response.json();
}

async function searchCities(name, count) {
  const params = new URLSearchParams({ name, count: String(count), language: "en", format: "json" });
  const data = await getJson(`${GEOCODING_URL}?${params}`);
  return data.results || [];
}

async function firstMatch(name) {
  const [place] = await searchCities(name, 1);
  if (!place) throw new Error(`No city found matching "${name}".`);
  return place;
}

async function getWeather(latitude, longitude, unit) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "7",
  });
  if (unit === "fahrenheit") {
    params.set("temperature_unit", "fahrenheit");
    params.set("wind_speed_unit", "mph");
  }
  return getJson(`${FORECAST_URL}?${params}`);
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Your browser can't share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          name: "My location",
          latitude: coords.latitude,
          longitude: coords.longitude,
          coords: `${coords.latitude.toFixed(2)}°, ${coords.longitude.toFixed(2)}°`,
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Location access was blocked. Allow it in your browser, or search for a city instead."
              : "Couldn't find your location. Try searching for a city instead."
          )
        ),
      { timeout: 10000, maximumAge: 600000 }
    );
  });
}

/* ---------- Saved preferences ---------- */

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ unit: state.unit, place: state.place }));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the app works without it.
  }
}

/* ---------- Rendering ---------- */

function renderHero(place, weather) {
  const { current, daily } = weather;
  const region = place.coords || regionOf(place);

  $("location").textContent = `${flag(place.country_code)} ${place.name}`.trim();
  $("local-time").textContent = [region, cityNow(weather.utc_offset_seconds)].filter(Boolean).join(" · ");
  $("temperature").textContent = deg(current.temperature_2m);
  $("description").textContent = labelFor(current.weather_code);
  $("hi-lo").textContent = `H ${deg(daily.temperature_2m_max[0])}  ·  L ${deg(daily.temperature_2m_min[0])}`;
  $("hero-icon").innerHTML = iconSvg(current.weather_code, current.is_day === 1);

  document.title = `${deg(current.temperature_2m)} ${place.name} · Weather Club`;
}

function smoothPath(points) {
  // Catmull-Rom spline converted to cubic Béziers for a gentle curve through every point.
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1].toFixed(1)}`;
  }
  return d;
}

// Indices into the hourly arrays for the next `count` hours, starting with the current hour.
function upcomingHours(weather, count) {
  const { hourly, current } = weather;
  const nowHour = current.time.slice(0, 13);
  let start = hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour);
  if (start < 0) start = 0;
  return hourly.time.slice(start, start + count).map((_, i) => start + i);
}

function renderHourly(weather) {
  const { hourly } = weather;
  const container = $("hourly");
  const indices = upcomingHours(weather, 24);

  // Temperature curve drawn across the top of the hour columns.
  const COL = 64;
  const HEIGHT = 70;
  const temps = indices.map((i) => hourly.temperature_2m[i]);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const y = (t) => 10 + ((max - t) / (max - min || 1)) * (HEIGHT - 22);
  const points = temps.map((t, i) => [i * COL + COL / 2, y(t)]);
  const width = indices.length * COL;
  const line = smoothPath(points);
  const last = points[points.length - 1][0];

  const chart =
    `<svg class="temp-chart" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" aria-hidden="true">` +
    `<defs><linearGradient id="temp-area" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<path class="area" d="${line} L${last},${HEIGHT} L${points[0][0]},${HEIGHT} Z"/>` +
    points.map(([px, py], i) => `<line class="guide" data-i="${i}" x1="${px}" y1="${py}" x2="${px}" y2="${HEIGHT}"/>`).join("") +
    `<path class="line" d="${line}"/>` +
    points.map(([px, py], i) => `<circle class="dot${i === 0 ? " now" : ""}" data-i="${i}" cx="${px}" cy="${py.toFixed(1)}" r="4.5"/>`).join("") +
    `</svg>`;

  container.innerHTML = chart;

  indices.forEach((index, i) => {
    const hour = el("div", "hour");
    hour.dataset.i = i;
    hour.append(el("span", "hour-time", i === 0 ? "Now" : formatHour(hourly.time[index])));
    const icon = el("span", "hour-icon");
    icon.innerHTML = iconSvg(hourly.weather_code[index], hourly.is_day[index] === 1);
    hour.append(icon);
    hour.append(el("span", "hour-temp", deg(hourly.temperature_2m[index])));
    const pop = hourly.precipitation_probability?.[index];
    hour.append(el("span", "hour-pop", pop >= 10 ? `${pop}%` : ""));
    container.append(hour);
  });

  $("hourly").parentElement.scrollLeft = 0;
}

function highlightHour(i) {
  document.querySelectorAll("#hourly .active").forEach((node) => node.classList.remove("active"));
  if (i === null) return;
  document.querySelectorAll(`#hourly [data-i="${i}"]`).forEach((node) => node.classList.add("active"));
}

function renderDaily(weather) {
  const { daily, current } = weather;
  const list = $("daily");
  list.replaceChildren();

  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const span = weekMax - weekMin || 1;
  const pct = (t) => ((t - weekMin) / span) * 100;

  daily.time.forEach((date, i) => {
    const lo = daily.temperature_2m_min[i];
    const hi = daily.temperature_2m_max[i];
    const row = el("li", "day");

    row.append(el("span", "day-name", i === 0 ? "Today" : weekday(date)));
    const icon = el("span", "day-icon");
    icon.innerHTML = iconSvg(daily.weather_code[i], true);
    icon.title = labelFor(daily.weather_code[i]);
    row.append(icon);
    const pop = daily.precipitation_probability_max?.[i];
    row.append(el("span", "day-pop", pop >= 10 ? `${pop}%` : ""));
    row.append(el("span", "day-min", deg(lo)));

    const range = el("span", "range");
    const fill = el("span", "range-fill");
    const left = pct(lo) / 100;
    const width = Math.max((hi - lo) / span, 0.02);
    fill.style.left = `${left * 100}%`;
    fill.style.width = `${width * 100}%`;
    // Size the gradient to the whole week so colours mean the same temperature on every row.
    fill.style.setProperty("--span", `${100 / width}%`);
    fill.style.setProperty("--offset", width >= 1 ? "0%" : `${(left / (1 - width)) * 100}%`);
    range.append(fill);
    if (i === 0) {
      const now = el("span", "range-now");
      now.style.left = `${Math.min(Math.max(pct(current.temperature_2m), pct(lo)), pct(hi))}%`;
      range.append(now);
    }
    row.append(range);
    row.append(el("span", "day-max", deg(hi)));
    list.append(row);
  });
}

function tile({ label, value, unit, sub, side, extra }) {
  const node = el("div", "tile");
  node.append(el("div", "tile-label", label));
  const row = el("div", "tile-row");
  const text = el("div");
  const valueEl = el("div", "tile-value", value);
  if (unit) valueEl.append(" ", el("small", "", unit));
  text.append(valueEl);
  if (sub) text.append(el("div", "tile-sub", sub));
  row.append(text);
  if (side) row.append(side);
  node.append(row);
  if (extra) node.append(extra);
  return node;
}

function meter(fraction, className = "") {
  const bar = el("div", `meter ${className}`.trim());
  const fill = el("span");
  const clamped = Math.min(Math.max(fraction, 0), 1);
  if (className === "uv") fill.style.left = `${clamped * 100}%`;
  else fill.style.width = `${clamped * 100}%`;
  bar.append(fill);
  return bar;
}

function renderDetails(weather) {
  const { current, daily } = weather;
  const details = $("details");
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";

  const feelsDiff = current.apparent_temperature - current.temperature_2m;
  const threshold = state.unit === "fahrenheit" ? 3 : 2;
  const feelsSub =
    feelsDiff > threshold ? "Feels warmer than it is" : feelsDiff < -threshold ? "Feels colder than it is" : "Close to the actual temperature";

  const humidity = current.relative_humidity_2m;
  const humiditySub = humidity >= 70 ? "Humid" : humidity <= 30 ? "Dry" : "Comfortable";

  const compass = el("div", "compass");
  compass.append(el("span", "n", "N"));
  compass.insertAdjacentHTML(
    "beforeend",
    `<svg class="arrow" viewBox="0 0 46 46" aria-hidden="true" style="transform: rotate(${(current.wind_direction_10m + 180) % 360}deg)">` +
      `<path d="M23 9l6 13h-4.2v14h-3.6V22H17z" fill="#fff"/></svg>`
  );

  const uv = daily.uv_index_max?.[0] ?? 0;
  const uvLevel = uv < 3 ? "Low" : uv < 6 ? "Moderate" : uv < 8 ? "High" : uv < 11 ? "Very high" : "Extreme";

  details.replaceChildren(
    tile({ label: "Feels like", value: deg(current.apparent_temperature), sub: feelsSub }),
    tile({ label: "Humidity", value: `${humidity}%`, sub: humiditySub, extra: meter(humidity / 100) }),
    tile({
      label: "Wind",
      value: String(Math.round(current.wind_speed_10m)),
      unit: windUnit,
      sub: `From the ${compassPoint(current.wind_direction_10m)}`,
      side: compass,
    }),
    tile({ label: "UV index", value: String(Math.round(uv)), sub: `${uvLevel} today`, extra: meter(uv / 11, "uv") }),
    tile({ label: "Sunrise", value: formatClock(daily.sunrise[0]), sub: `Sunset ${formatClock(daily.sunset[0])}` }),
    tile({ label: "Pressure", value: String(Math.round(current.pressure_msl)), unit: "hPa", sub: `${current.cloud_cover}% cloud cover` })
  );
}

/* ---------- What to wear ---------- */

// Outfits by how warm it feels (°C). The first entry whose `min` is at or below the feels-like temperature wins.
const OUTFITS = [
  {
    min: 28,
    title: "Sundress weather",
    items: [["👗", "Breezy sundress or linen shorts"], ["🩴", "Flat sandals"], ["👒", "Wide-brim hat"], ["🕶️", "Sunglasses"]],
  },
  {
    min: 22,
    title: "Light & breezy",
    items: [["👚", "Tee or silky camisole"], ["👖", "Linen trousers or a midi skirt"], ["👟", "White sneakers or sandals"], ["🕶️", "Sunglasses"]],
  },
  {
    min: 16,
    title: "Easy layers",
    items: [["👚", "Blouse or light knit"], ["👖", "Jeans or wide-leg trousers"], ["🧥", "Denim jacket or blazer"], ["👟", "Loafers or sneakers"]],
  },
  {
    min: 10,
    title: "Jacket weather",
    items: [["🧶", "Fine-knit sweater"], ["🧥", "Trench coat or leather jacket"], ["👖", "Straight-leg jeans"], ["👢", "Ankle boots"]],
  },
  {
    min: 3,
    title: "Coat & knitwear",
    items: [["🧥", "Wool coat"], ["🧶", "Chunky knit sweater"], ["👖", "Trousers, or a skirt with warm tights"], ["👢", "Leather ankle boots"], ["🧣", "Scarf"]],
  },
  {
    min: -Infinity,
    title: "Bundle up",
    items: [["🧥", "Long puffer coat"], ["🧶", "Thermal layer under a cosy knit"], ["🧣", "Scarf & beanie"], ["🧤", "Gloves"], ["🥾", "Insulated boots"]],
  },
];

const SHOES = ["🩴", "👟", "👢", "🥾"];

function suggestOutfit(weather) {
  const { current, hourly, daily } = weather;
  const fahrenheit = state.unit === "fahrenheit";
  const toC = (t) => (fahrenheit ? ((t - 32) * 5) / 9 : t);
  const windKmh = fahrenheit ? current.wind_speed_10m * 1.609 : current.wind_speed_10m;

  const next = upcomingHours(weather, 12);
  const feels = toC(current.apparent_temperature);
  const temps = next.map((i) => hourly.temperature_2m[i]);
  const rainChance = Math.max(0, ...next.map((i) => hourly.precipitation_probability?.[i] ?? 0));
  const conditionsAhead = [current.weather_code, ...next.map((i) => hourly.weather_code[i])].map(conditionFor);
  const wetNow = ["rain", "drizzle", "storm"].includes(conditionFor(current.weather_code));
  const snowy = conditionsAhead.includes("snow");
  const stormy = conditionsAhead.includes("storm");
  const rainy = wetNow || rainChance >= 50;
  const uv = daily.uv_index_max?.[0] ?? 0;
  const daytime = current.is_day === 1;

  const outfit = OUTFITS.find((o) => feels >= o.min);
  const cool = feels < 22;
  let items = outfit.items.map(([emoji, label]) => ({ emoji, label }));
  const replaceShoes = (emoji, label) => {
    const shoe = items.find((item) => SHOES.includes(item.emoji));
    if (shoe) Object.assign(shoe, { emoji, label });
    else items.push({ emoji, label });
  };

  if (snowy) {
    replaceShoes("🥾", "Waterproof boots with good grip");
    if (!items.some((item) => item.emoji === "🧤")) items.push({ emoji: "🧤", label: "Gloves" });
  } else if (rainy && cool) {
    replaceShoes("🥾", "Waterproof boots");
  }
  if (rainy && !snowy) {
    items.push(
      windKmh >= 40
        ? { emoji: "🧥", label: "Hooded rain jacket (too windy for an umbrella)" }
        : { emoji: "☂️", label: "Umbrella" }
    );
  }
  if (wetNow) {
    items = items.filter((item) => item.emoji !== "🕶️");
  } else if (uv >= 3 && daytime && !items.some((item) => item.emoji === "🕶️")) {
    items.push({ emoji: "🕶️", label: "Sunglasses" });
  }

  // Tips about the day ahead.
  const tips = [];
  if (stormy) tips.push(["⛈️", "Thunderstorms are possible, so keep outdoor plans flexible."]);
  if (snowy) tips.push(["❄️", `${rainChance}% chance of snow in the next 12 hours. Watch out for slippery pavements.`]);
  else if (rainy) tips.push(["☔", `${rainChance}% chance of rain in the next 12 hours. Leave suede and canvas shoes at home.`]);
  else if (rainChance >= 30) tips.push(["🌂", `${rainChance}% chance of rain later. A compact umbrella in your bag wouldn't hurt.`]);

  const peak = temps.indexOf(Math.max(...temps));
  const low = temps.indexOf(Math.min(...temps));
  const swing = toC(temps[peak]) - toC(temps[low]);
  const warming = peak > low;
  const target = warming ? peak : low;
  // Only worth mentioning if it changes what you'd wear: shedding layers, or needing one later.
  if (swing >= 7 && (warming || toC(temps[target]) < 20)) {
    tips.push([
      "🌡️",
      warming
        ? `Warming up to ${deg(temps[target])} by ${formatHour(hourly.time[next[target]])}, so wear layers you can take off.`
        : `Cooling to ${deg(temps[target])} by ${formatHour(hourly.time[next[target]])}, so bring an extra layer for later.`,
    ]);
  }

  if (windKmh >= 30) {
    tips.push(["💨", `Windy (${Math.round(current.wind_speed_10m)} ${fahrenheit ? "mph" : "km/h"}). Fitted pieces or trousers beat anything flowy today.`]);
  }
  if (uv >= 6) tips.push(["🧴", `UV is high (${Math.round(uv)}). Wear SPF 50 and reapply if you're outside for long.`]);
  else if (uv >= 3) tips.push(["🧴", `Moderate UV (${Math.round(uv)}). SPF 30 on your face is a good idea.`]);
  if (current.relative_humidity_2m >= 75 && feels >= 22) {
    tips.push(["💧", "It's humid, so breathable linen or cotton will feel best."]);
  }
  if (tips.length === 0) tips.push(["✨", "No surprises in the forecast. Dress for comfort and enjoy it."]);

  const summary = [`Feels like ${deg(current.apparent_temperature)} right now`];
  if (rainChance >= 30) summary.push(`${rainChance}% chance of ${snowy ? "snow" : "rain"}`);

  return { title: outfit.title, summary: summary.join(" · "), items, tips };
}

function renderOutfit(weather) {
  const { title, summary, items, tips } = suggestOutfit(weather);
  $("outfit-title").textContent = title;
  $("outfit-summary").textContent = summary;

  $("outfit-items").replaceChildren(
    ...items.map(({ emoji, label }) => {
      const item = el("li");
      const icon = el("span", "outfit-emoji", emoji);
      icon.setAttribute("aria-hidden", "true");
      item.append(icon, el("span", "", label));
      return item;
    })
  );

  $("outfit-tips").replaceChildren(
    ...tips.map(([emoji, text]) => {
      const item = el("li");
      const icon = el("span", "tip-emoji", emoji);
      icon.setAttribute("aria-hidden", "true");
      item.append(icon, el("span", "", text));
      return item;
    })
  );
}

function render(place, weather) {
  applySky(weather.current.weather_code, weather.current.is_day === 1);
  renderHero(place, weather);
  renderHourly(weather);
  renderDaily(weather);
  renderDetails(weather);
  renderOutfit(weather);
  welcomeEl.hidden = true;
  weatherEl.hidden = false;
}

/* ---------- Loading flow ---------- */

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setBusy(busy) {
  searchBtn.disabled = busy;
  weatherEl.classList.toggle("refreshing", busy && !weatherEl.hidden);
}

function keepPlace(place) {
  const { name, admin1, country, country_code, latitude, longitude, coords } = place;
  return { name, admin1, country, country_code, latitude, longitude, coords };
}

async function load(getPlace, message) {
  const id = ++state.requestId;
  hideSuggestions();
  setBusy(true);
  setStatus(message);
  try {
    const place = await getPlace();
    const weather = await getWeather(place.latitude, place.longitude, state.unit);
    if (id !== state.requestId) return;
    state.place = keepPlace(place);
    save();
    render(state.place, weather);
    setStatus("");
  } catch (error) {
    if (id !== state.requestId) return;
    setStatus(error.message || "Something went wrong. Please try again.", true);
  } finally {
    if (id === state.requestId) {
      setBusy(false);
      locateBtn.classList.remove("busy");
    }
  }
}

/* ---------- Search suggestions ---------- */

let suggestTimer = 0;
let suggestId = 0;

function hideSuggestions() {
  clearTimeout(suggestTimer);
  suggestId++;
  state.suggestions = [];
  state.activeIndex = -1;
  suggestionsEl.hidden = true;
  suggestionsEl.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function showSuggestions(results) {
  if (results.length === 0) {
    hideSuggestions();
    return;
  }
  state.suggestions = results;
  state.activeIndex = -1;
  suggestionsEl.replaceChildren(
    ...results.map((place, i) => {
      const item = el("li");
      item.id = `suggestion-${i}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.append(el("span", "s-flag", flag(place.country_code)));
      item.append(el("span", "s-name", place.name));
      item.append(el("span", "s-region", regionOf(place)));
      item.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus in the input
      item.addEventListener("click", () => choose(i));
      return item;
    })
  );
  suggestionsEl.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function setActive(index) {
  const items = suggestionsEl.children;
  state.activeIndex = (index + items.length) % items.length;
  [...items].forEach((item, i) => item.setAttribute("aria-selected", String(i === state.activeIndex)));
  input.setAttribute("aria-activedescendant", items[state.activeIndex].id);
}

function choose(index) {
  const place = state.suggestions[index];
  if (!place) return;
  input.value = place.name;
  load(async () => place, `Loading ${place.name}…`);
}

input.addEventListener("input", () => {
  clearTimeout(suggestTimer);
  const query = input.value.trim();
  if (query.length < 2) {
    hideSuggestions();
    return;
  }
  suggestTimer = setTimeout(async () => {
    const id = ++suggestId;
    try {
      const results = await searchCities(query, 6);
      if (id === suggestId && input.value.trim() === query) showSuggestions(results);
    } catch {
      // Suggestions are best-effort; pressing Search reports real errors.
    }
  }, 220);
});

input.addEventListener("keydown", (event) => {
  if (suggestionsEl.hidden) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setActive(state.activeIndex + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Escape") {
    hideSuggestions();
  }
});

input.addEventListener("blur", hideSuggestions);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!suggestionsEl.hidden && state.activeIndex >= 0) {
    choose(state.activeIndex);
    return;
  }
  const query = input.value.trim();
  if (!query) {
    input.focus();
    return;
  }
  load(() => firstMatch(query), `Searching for ${query}…`);
});

/* ---------- Other controls ---------- */

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.city;
    load(() => firstMatch(chip.dataset.city), `Loading ${chip.dataset.city}…`);
  });
});

locateBtn.addEventListener("click", () => {
  locateBtn.classList.add("busy");
  input.value = "";
  load(locate, "Finding your location…");
});

function setUnit(unit) {
  state.unit = unit;
  document.querySelectorAll(".unit-toggle button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.unit === unit));
  });
}

document.querySelectorAll(".unit-toggle button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.unit === state.unit) return;
    setUnit(button.dataset.unit);
    save();
    if (state.place) {
      const place = state.place;
      load(async () => place, "Switching units…");
    }
  });
});

const hourlyEl = $("hourly");
hourlyEl.addEventListener("pointerover", (event) => {
  const hour = event.target.closest(".hour");
  if (hour) highlightHour(hour.dataset.i);
});
hourlyEl.addEventListener("pointerleave", () => highlightHour(null));

/* ---------- Start ---------- */

$("brand-icon").innerHTML = iconSvg(2, true);
sky.init();
sky.set("stars", 0.6);

const saved = loadSaved();
setUnit(saved.unit === "fahrenheit" ? "fahrenheit" : "celsius");
if (saved.place && typeof saved.place.latitude === "number") {
  const place = saved.place;
  load(async () => place, `Loading ${place.name}…`);
}
