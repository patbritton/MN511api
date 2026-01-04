# MN511 Importer Enhanced

A WordPress plugin that fetches MN511 traffic, weather, and road condition data from your MN511 API and displays it on your WordPress site.

## Features

- Fetches data every 30 minutes automatically
- Caches data to reduce API calls
- Creates WordPress custom post types for:
  - Alerts (incidents, closures, etc.)
  - Weather Stations (RWIS data)
  - Digital Message Signs
- Provides shortcodes for easy content embedding
- Includes basic styling

## Installation

1. Copy the `mn511-importer` folder to your WordPress `wp-content/plugins/` directory
2. Activate the plugin in WordPress Admin > Plugins
3. Configure the API endpoint and bbox in the plugin file (see Configuration)

## Configuration

Edit these constants in `mn511-importer.php`:

```php
define('MN511_API_BASE', 'https://511.mp.ls/api'); // Your API URL
define('MN511_BBOX', '-93.35,44.90,-93.15,45.02'); // minLon,minLat,maxLon,maxLat
define('MN511_ZOOM', '12'); // Zoom level for API requests
```

## Shortcodes

### General shortcode

```
[mn511 endpoint="alerts"]
```

Available endpoints:
- `alerts` - Traffic alerts and incidents
- `incidents` - Just incidents
- `closures` - Road closures
- `cameras` - Traffic cameras
- `weather-stations` - Road weather information stations
- `signs` - Digital message signs
- `plows` - Snow plows
- `road-conditions` - Road condition data
- `weather-events` - Weather events

### Specific shortcodes

```
[mn511_alerts]
[mn511_weather]
[mn511_signs]
```

## Custom Post Types

The plugin creates three custom post types that sync with the API data:

1. **MN511 Alerts** - Traffic incidents and closures
2. **MN511 Weather Stations** - RWIS station data
3. **MN511 Signs** - Digital message sign content

These are visible in the WordPress admin and can be queried or displayed using standard WordPress functions.

## Caching

Data is cached for 30 minutes (1800 seconds). The cache is automatically refreshed every 30 minutes via WordPress cron.

To manually trigger a refresh, you can:
1. Deactivate and reactivate the plugin
2. Wait for the next scheduled cron run
3. Call `mn511_fetch_and_cache()` programmatically

## Styling

Basic CSS is included and automatically enqueued. You can override these styles in your theme:

- `.mn511-container` - Main container
- `.mn511-list` - List wrapper
- `.mn511-item` - Individual item
- `.mn511-title` - Item title
- `.mn511-tooltip` - Item description
- `.mn511-timestamp` - Last updated timestamp
- `.mn511-no-data` - No data message

## Requirements

- WordPress 5.0+
- PHP 7.4+
- Active MN511 API endpoint

## Support

For issues or questions, please refer to the main MN511 API repository.
