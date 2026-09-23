# Weather Club

A simple static web page that looks up the current weather and a 7-day forecast for any city, using the free, open-source [Open-Meteo](https://open-meteo.com/) APIs (no API key required).

- [Geocoding API](https://open-meteo.com/en/docs/geocoding-api) turns the city name into coordinates.
- [Forecast API](https://open-meteo.com/en/docs) returns current conditions and the hourly and daily forecast for those coordinates.

## Features

- Animated sky that matches the real weather and time of day: sun, moon and stars, drifting clouds, rain, snow and lightning
- Animated weather icons
- City suggestions as you type (with flags, so you can tell Springfield, Illinois from Springfield, Missouri)
- "Use my location" button
- °C / °F switch
- Next 24 hours with a temperature curve, a 7-day forecast with temperature range bars, and details (feels like, humidity, wind direction, UV index, sunrise/sunset, pressure)
- Remembers your last city and unit
- Works on phones and respects the "reduce motion" accessibility setting

## Running it

No build step or dependencies. Open `index.html` in a browser, or serve the folder locally:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Files

- `index.html` – page markup
- `style.css` – styles (supports light and dark mode)
- `app.js` – fetches data from Open-Meteo and renders it
