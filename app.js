const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// WMO weather interpretation codes used by Open-Meteo.
const WEATHER_CODES = {
  0: ["Clear sky", "☀️"],
  1: ["Mainly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Depositing rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Moderate drizzle", "🌦️"],
  55: ["Dense drizzle", "🌦️"],
  56: ["Light freezing drizzle", "🌧️"],
  57: ["Dense freezing drizzle", "🌧️"],
  61: ["Slight rain", "🌧️"],
  63: ["Moderate rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  66: ["Light freezing rain", "🌧️"],
  67: ["Heavy freezing rain", "🌧️"],
  71: ["Slight snowfall", "🌨️"],
  73: ["Moderate snowfall", "🌨️"],
  75: ["Heavy snowfall", "❄️"],
  77: ["Snow grains", "🌨️"],
  80: ["Slight rain showers", "🌦️"],
  81: ["Moderate rain showers", "🌦️"],
  82: ["Violent rain showers", "⛈️"],
  85: ["Slight snow showers", "🌨️"],
  86: ["Heavy snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm with slight hail", "⛈️"],
  99: ["Thunderstorm with heavy hail", "⛈️"],
};

const form = document.getElementById("search-form");
const input = document.getElementById("city-input");
const button = form.querySelector("button");
const statusEl = document.getElementById("status");
const currentEl = document.getElementById("current");
const forecastEl = document.getElementById("forecast");

function describe(code) {
  return WEATHER_CODES[code] || ["Unknown", "❔"];
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

async function findCity(name) {
  const params = new URLSearchParams({ name, count: "1", language: "en", format: "json" });
  const data = await getJson(`${GEOCODING_URL}?${params}`);
  if (!data.results || data.results.length === 0) {
    throw new Error(`No city found matching "${name}".`);
  }
  return data.results[0];
}

async function getWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
  });
  return getJson(`${FORECAST_URL}?${params}`);
}

function renderCurrent(place, weather) {
  const { current, current_units: units } = weather;
  const [label, icon] = describe(current.weather_code);
  const region = [place.admin1, place.country].filter(Boolean).join(", ");

  document.getElementById("location").textContent = region ? `${place.name}, ${region}` : place.name;
  document.getElementById("icon").textContent = icon;
  document.getElementById("temperature").textContent =
    `${Math.round(current.temperature_2m)}${units.temperature_2m}`;
  document.getElementById("description").textContent = label;
  document.getElementById("feels-like").textContent =
    `${Math.round(current.apparent_temperature)}${units.apparent_temperature}`;
  document.getElementById("humidity").textContent =
    `${current.relative_humidity_2m}${units.relative_humidity_2m}`;
  document.getElementById("wind").textContent =
    `${current.wind_speed_10m} ${units.wind_speed_10m}`;
  document.getElementById("precipitation").textContent =
    `${current.precipitation} ${units.precipitation}`;

  currentEl.hidden = false;
}

function renderForecast(weather) {
  const { daily } = weather;
  const list = document.getElementById("forecast-list");
  list.replaceChildren();

  daily.time.forEach((date, i) => {
    const [label, icon] = describe(daily.weather_code[i]);
    // Parse as local noon so the weekday isn't shifted by the viewer's timezone.
    const day = new Date(`${date}T12:00:00`).toLocaleDateString("en", { weekday: "short" });

    const li = document.createElement("li");
    const cells = [
      ["day", i === 0 ? "Today" : day],
      ["icon-small", icon],
      ["desc", label],
      ["temps", `${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°`],
    ];
    for (const [className, text] of cells) {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = text;
      li.appendChild(span);
    }
    list.appendChild(li);
  });

  forecastEl.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const city = input.value.trim();
  if (!city) return;

  button.disabled = true;
  setStatus("Loading…");

  try {
    const place = await findCity(city);
    const weather = await getWeather(place.latitude, place.longitude);
    renderCurrent(place, weather);
    renderForecast(weather);
    setStatus("");
  } catch (error) {
    currentEl.hidden = true;
    forecastEl.hidden = true;
    setStatus(error.message || "Something went wrong. Please try again.", true);
  } finally {
    button.disabled = false;
  }
});
