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
    if (empty($feature['properties']['raw'])) {
        return null;
    }
    $raw = $feature['properties']['raw'];

    $candidates = array(
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

function mn511_filter_past_hour($features) {
    $now_ms = (int) (microtime(true) * 1000);
    $cutoff_ms = $now_ms - (60 * 60 * 1000);
    $out = array();

    foreach ($features as $feature) {
        $updated_ms = mn511_extract_updated_ms($feature);
        if ($updated_ms === null) {
            $out[] = $feature;
            continue;
        }

        // Heuristic: convert seconds to ms if needed.
        if ($updated_ms < 2000000000) {
            $updated_ms *= 1000;
        }

        if ($updated_ms >= $cutoff_ms) {
            $out[] = $feature;
        }
    }

    return $out;
}

function mn511_fetch_and_cache() {
    $cache = array(
        'fetched_at' => gmdate('c'),
        'endpoints' => array(),
    );

    foreach (mn511_get_endpoints() as $endpoint) {
        $url = mn511_build_url($endpoint);
        $resp = wp_remote_get($url, array('timeout' => 15));
        if (is_wp_error($resp)) {
            continue;
        }
        $code = wp_remote_retrieve_response_code($resp);
        if ($code < 200 || $code >= 300) {
            continue;
        }

        $body = wp_remote_retrieve_body($resp);
        $json = json_decode($body, true);
        if (!is_array($json) || empty($json['features'])) {
            $cache['endpoints'][$endpoint] = array();
            continue;
        }

        $features = mn511_filter_past_hour($json['features']);
        $cache['endpoints'][$endpoint] = $features;
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

    $items = $cache['endpoints'][$atts['endpoint']];
    $out = '<ul class="mn511-list">';
    foreach ($items as $feature) {
        $p = $feature['properties'] ?? array();
        $title = esc_html($p['title'] ?? 'Alert');
        $tooltip = isset($p['tooltip']) ? wp_kses_post($p['tooltip']) : '';
        $out .= '<li><strong>' . $title . '</strong><div>' . $tooltip . '</div></li>';
    }
    $out .= '</ul>';
    return $out;
}
add_shortcode('mn511_alerts', 'mn511_shortcode');
