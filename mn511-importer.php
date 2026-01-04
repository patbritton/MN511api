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
define('MN511_ALERT_POST_TYPE', 'mn511_alert');
define('MN511_ALERT_UID_META', '_mn511_uid');
define('MN511_ALERT_UPDATED_META', '_mn511_updated_at');
define('MN511_ALERT_FETCHED_META', '_mn511_fetched_at');
define('MN511_ALERT_RAW_META', '_mn511_raw');

function mn511_register_post_type() {
    register_post_type(MN511_ALERT_POST_TYPE, array(
        'label' => 'MN511 Alerts',
        'public' => false,
        'show_ui' => true,
        'supports' => array('title', 'editor', 'custom-fields'),
    ));
}
add_action('init', 'mn511_register_post_type');

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

        if ($endpoint === 'alerts') {
            mn511_sync_alert_posts($json['features'], $cache['endpoints'][$endpoint]['fetched_at']);
        }
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

function mn511_extract_feature_uid($feature) {
    if (!is_array($feature)) {
        return null;
    }
    $properties = $feature['properties'] ?? array();
    $raw = $properties['raw'] ?? array();
    $candidates = array(
        $feature['id'] ?? null,
        $properties['id'] ?? null,
        $properties['uri'] ?? null,
        $raw['id'] ?? null,
        $raw['uri'] ?? null,
    );

    foreach ($candidates as $value) {
        if (!empty($value)) {
            return (string) $value;
        }
    }

    return null;
}

function mn511_sync_alert_posts($features, $fetched_at) {
    if (!is_array($features)) {
        return;
    }

    $current_ids = array();
    foreach ($features as $feature) {
        $uid = mn511_extract_feature_uid($feature);
        if (!$uid) {
            continue;
        }
        $current_ids[] = $uid;
        $p = $feature['properties'] ?? array();
        $title = sanitize_text_field($p['title'] ?? 'Alert');
        $tooltip = isset($p['tooltip']) ? wp_kses_post($p['tooltip']) : '';
        $updated_ms = mn511_extract_updated_ms($feature);
        $updated_display = mn511_format_timestamp($updated_ms);

        $existing = get_posts(array(
            'post_type' => MN511_ALERT_POST_TYPE,
            'post_status' => array('publish', 'draft', 'pending', 'private', 'trash'),
            'meta_key' => MN511_ALERT_UID_META,
            'meta_value' => $uid,
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ));

        $post_data = array(
            'post_title' => $title,
            'post_content' => $tooltip,
            'post_status' => 'publish',
            'post_type' => MN511_ALERT_POST_TYPE,
        );

        if (!empty($existing)) {
            $post_data['ID'] = $existing[0];
            wp_update_post($post_data);
            $post_id = $existing[0];
        } else {
            $post_id = wp_insert_post($post_data);
        }

        if ($post_id && !is_wp_error($post_id)) {
            update_post_meta($post_id, MN511_ALERT_UID_META, $uid);
            if ($updated_display) {
                update_post_meta($post_id, MN511_ALERT_UPDATED_META, $updated_display);
            }
            update_post_meta($post_id, MN511_ALERT_FETCHED_META, $fetched_at);
            update_post_meta($post_id, MN511_ALERT_RAW_META, wp_json_encode($feature));
        }
    }

    $existing_posts = get_posts(array(
        'post_type' => MN511_ALERT_POST_TYPE,
        'post_status' => array('publish', 'draft', 'pending', 'private'),
        'meta_key' => MN511_ALERT_UID_META,
        'posts_per_page' => -1,
        'fields' => 'ids',
        'no_found_rows' => true,
    ));

    foreach ($existing_posts as $post_id) {
        $uid = get_post_meta($post_id, MN511_ALERT_UID_META, true);
        if ($uid && !in_array($uid, $current_ids, true)) {
            wp_trash_post($post_id);
        }
    }
}

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
