<?php
/**
 * Plugin Name: MN511 Importer
 * Description: Fetches MN511 API data every 30 minutes, caches it, and exposes a shortcode.
 * Version: 0.1.0
 * Author: You
 */

if (!defined('ABSPATH')) {
    exit;
}

// Configuration.
define('MN511_API_BASE', 'https://511.mp.ls/api');
define('MN511_BBOX', '-93.35,44.90,-93.15,45.02'); // minLon,minLat,maxLon,maxLat
define('MN511_ZOOM', '12');
define('MN511_CACHE_TTL', 30 * 60);

function mn511_get_endpoints() {
    return array(
        'incidents',
        'closures',
        'cameras',
        'plows',
        'road-conditions',
        'weather-events',
        'alerts',
    );
}

function mn511_build_url($endpoint) {
    $args = array(
        'bbox' => MN511_BBOX,
        'zoom' => MN511_ZOOM,
    );
    return add_query_arg($args, trailingslashit(MN511_API_BASE) . $endpoint);
}

function mn511_extract_updated_ms($feature) {
    $raw = $feature['properties']['raw'] ?? array();

    $candidates = array(
        $feature['properties']['lastUpdated'] ?? null,
        $feature['properties']['updateTime'] ?? null,
        $feature['properties']['timestamp'] ?? null,
        $raw['lastUpdated']['timestamp'] ?? null,
        $raw['lastUpdated']['time'] ?? null,
        $raw['updateTime']['time'] ?? null,
        $raw['_eventReport']['lastUpdated']['timestamp'] ?? null,
        $raw['_eventReport']['updateTime']['time'] ?? null,
    );

    foreach ($candidates as $value) {
        if (is_numeric($value)) {
            return (int) $value;
        }
    }

    return null;
}

function mn511_format_timestamp($timestamp) {
    if (!is_numeric($timestamp)) {
        return null;
    }
    $value = (int) $timestamp;
    if ($value < 2000000000) {
        $value *= 1000;
    }
    return wp_date('c', (int) ($value / 1000));
}

function mn511_format_iso_string($value) {
    if (empty($value)) {
        return null;
    }
    $ts = strtotime($value);
    if ($ts === false) {
        return null;
    }
    return wp_date('c', $ts);
}

function mn511_fetch_and_cache() {
    $previous = get_transient('mn511_cache');
    $cache = array(
        'fetched_at' => gmdate('c'),
        'endpoints' => array(),
    );

    foreach (mn511_get_endpoints() as $endpoint) {
        $url = mn511_build_url($endpoint);
        $resp = wp_remote_get($url, array('timeout' => 15));
        if (is_wp_error($resp)) {
            if (!empty($previous['endpoints'][$endpoint])) {
                $cache['endpoints'][$endpoint] = $previous['endpoints'][$endpoint];
            }
            continue;
        }
        $code = wp_remote_retrieve_response_code($resp);
        if ($code < 200 || $code >= 300) {
            if (!empty($previous['endpoints'][$endpoint])) {
                $cache['endpoints'][$endpoint] = $previous['endpoints'][$endpoint];
            }
            continue;
        }

        $body = wp_remote_retrieve_body($resp);
        $json = json_decode($body, true);
        if (!is_array($json) || !isset($json['features']) || !is_array($json['features'])) {
            $cache['endpoints'][$endpoint] = array(
                'fetched_at' => gmdate('c'),
                'items' => array(),
            );
            continue;
        }

        $cache['endpoints'][$endpoint] = array(
            'fetched_at' => gmdate('c'),
            'items' => $json['features'],
        );
    }

    set_transient('mn511_cache', $cache, MN511_CACHE_TTL);
}

function mn511_cron_schedule($schedules) {
    if (!isset($schedules['mn511_30min'])) {
        $schedules['mn511_30min'] = array(
            'interval' => 30 * 60,
            'display' => 'Every 30 Minutes',
        );
    }
    return $schedules;
}
add_filter('cron_schedules', 'mn511_cron_schedule');

function mn511_schedule_cron() {
    if (!wp_next_scheduled('mn511_fetch_event')) {
        wp_schedule_event(time(), 'mn511_30min', 'mn511_fetch_event');
    }
}
add_action('init', 'mn511_schedule_cron');
add_action('mn511_fetch_event', 'mn511_fetch_and_cache');

register_activation_hook(__FILE__, function () {
    mn511_fetch_and_cache();
});

register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('mn511_fetch_event');
    delete_transient('mn511_cache');
});

// Simple shortcode to render a list.
function mn511_shortcode($atts) {
    $atts = shortcode_atts(array('endpoint' => 'alerts'), $atts);
    $cache = get_transient('mn511_cache');
    if (empty($cache['endpoints'][$atts['endpoint']])) {
        return '<div>No data available.</div>';
    }

    $endpoint_data = $cache['endpoints'][$atts['endpoint']];
    $items = $endpoint_data['items'] ?? $endpoint_data;
    if (empty($items) || !is_array($items)) {
        return '<div>No data available.</div>';
    }

    $endpoint_fetched = $endpoint_data['fetched_at'] ?? $cache['fetched_at'] ?? null;
    $endpoint_fetched = mn511_format_iso_string($endpoint_fetched) ?? $endpoint_fetched;
    $out = '<div class="mn511-fetched">Fetched: ' . esc_html($endpoint_fetched ?? 'unknown') . '</div>';
    $out .= '<ul class="mn511-list">';
    foreach ($items as $feature) {
        $p = $feature['properties'] ?? array();
        $title = esc_html($p['title'] ?? 'Alert');
        $tooltip = isset($p['tooltip']) ? wp_kses_post($p['tooltip']) : '';
        $updated_raw = mn511_extract_updated_ms($feature);
        $updated_display = mn511_format_timestamp($updated_raw);
        $timestamp_html = $updated_display ? '<div class="mn511-timestamp">Updated: ' . esc_html($updated_display) . '</div>' : '';
        $out .= '<li><strong>' . $title . '</strong><div>' . $tooltip . '</div>' . $timestamp_html . '</li>';
    }
    $out .= '</ul>';
    return $out;
}
add_shortcode('mn511_alerts', 'mn511_shortcode');
