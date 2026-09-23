# Weather Club

A simple static web page that looks up the current weather and a 7-day forecast for any city, using the free, open-source [Open-Meteo](https://open-meteo.com/) APIs (no API key required).

- [Geocoding API](https://open-meteo.com/en/docs/geocoding-api) turns the city name into coordinates.
- [Forecast API](https://open-meteo.com/en/docs) returns current conditions and the daily forecast for those coordinates.

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
