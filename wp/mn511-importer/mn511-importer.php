<?php
/**
 * Plugin Name: MN511 Importer Enhanced
 * Description: Fetches MN511 API data (incidents, cameras, weather stations, signs) every 30 minutes, caches it, and exposes shortcodes and widgets.
 * Version: 1.0.0
 * Author: Your Name
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

// Configuration
define('MN511_API_BASE', 'https://511.mp.ls/api');
define('MN511_BBOX', '-93.35,44.90,-93.15,45.02'); // minLon,minLat,maxLon,maxLat
define('MN511_ZOOM', '12');
define('MN511_CACHE_TTL', 30 * 60);
define('MN511_ALERT_POST_TYPE', 'mn511_alert');
define('MN511_WEATHER_POST_TYPE', 'mn511_weather');
define('MN511_SIGN_POST_TYPE', 'mn511_sign');
define('MN511_ALERT_UID_META', '_mn511_uid');
define('MN511_ALERT_UPDATED_META', '_mn511_updated_at');
define('MN511_ALERT_FETCHED_META', '_mn511_fetched_at');
define('MN511_ALERT_RAW_META', '_mn511_raw');

// Register post types
function mn511_register_post_types() {
    register_post_type(MN511_ALERT_POST_TYPE, array(
        'label' => 'MN511 Alerts',
        'public' => false,
        'show_ui' => true,
        'supports' => array('title', 'editor', 'custom-fields'),
        'menu_icon' => 'dashicons-warning',
    ));

    register_post_type(MN511_WEATHER_POST_TYPE, array(
        'label' => 'MN511 Weather Stations',
        'public' => false,
        'show_ui' => true,
        'supports' => array('title', 'editor', 'custom-fields'),
        'menu_icon' => 'dashicons-cloud',
    ));

    register_post_type(MN511_SIGN_POST_TYPE, array(
        'label' => 'MN511 Signs',
        'public' => false,
        'show_ui' => true,
        'supports' => array('title', 'editor', 'custom-fields'),
        'menu_icon' => 'dashicons-info',
    ));
}
add_action('init', 'mn511_register_post_types');

// Get available endpoints
function mn511_get_endpoints() {
    return array(
        'incidents',
        'closures',
        'cameras',
        'plows',
        'road-conditions',
        'weather-events',
        'weather-stations',
        'signs',
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
        $feature['properties']['lastUpdatedTimestamp'] ?? null,
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

// Fetch and cache data
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

        // Sync to custom post types
        if ($endpoint === 'alerts') {
            mn511_sync_alert_posts($json['features'], $cache['endpoints'][$endpoint]['fetched_at']);
        } elseif ($endpoint === 'weather-stations') {
            mn511_sync_weather_posts($json['features'], $cache['endpoints'][$endpoint]['fetched_at']);
        } elseif ($endpoint === 'signs') {
            mn511_sync_sign_posts($json['features'], $cache['endpoints'][$endpoint]['fetched_at']);
        }
    }

    set_transient('mn511_cache', $cache, MN511_CACHE_TTL);
}

// Cron setup
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

// Sync alerts to posts
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

// Sync weather stations to posts
function mn511_sync_weather_posts($features, $fetched_at) {
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
        $title = sanitize_text_field($p['title'] ?? 'Weather Station');
        $description = isset($p['description']) ? wp_kses_post($p['description']) : '';
        $status = sanitize_text_field($p['status'] ?? 'UNKNOWN');
        $route = sanitize_text_field($p['routeDesignator'] ?? '');

        $content = '<p><strong>Status:</strong> ' . esc_html($status) . '</p>';
        if ($route) {
            $content .= '<p><strong>Route:</strong> ' . esc_html($route) . '</p>';
        }
        if ($description) {
            $content .= '<p>' . $description . '</p>';
        }

        $existing = get_posts(array(
            'post_type' => MN511_WEATHER_POST_TYPE,
            'post_status' => array('publish', 'draft', 'pending', 'private', 'trash'),
            'meta_key' => MN511_ALERT_UID_META,
            'meta_value' => $uid,
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ));

        $post_data = array(
            'post_title' => $title,
            'post_content' => $content,
            'post_status' => 'publish',
            'post_type' => MN511_WEATHER_POST_TYPE,
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
            update_post_meta($post_id, MN511_ALERT_FETCHED_META, $fetched_at);
            update_post_meta($post_id, MN511_ALERT_RAW_META, wp_json_encode($feature));
            update_post_meta($post_id, '_mn511_status', $status);
            update_post_meta($post_id, '_mn511_route', $route);
        }
    }
}

// Sync signs to posts
function mn511_sync_sign_posts($features, $fetched_at) {
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
        $title = sanitize_text_field($p['title'] ?? 'Sign');
        $sign_status = sanitize_text_field($p['signStatus'] ?? 'UNKNOWN');
        $route = sanitize_text_field($p['routeDesignator'] ?? '');
        $city = sanitize_text_field($p['cityReference'] ?? '');

        $content = '<p><strong>Status:</strong> ' . esc_html($sign_status) . '</p>';
        if ($route) {
            $content .= '<p><strong>Route:</strong> ' . esc_html($route) . '</p>';
        }
        if ($city) {
            $content .= '<p><strong>City:</strong> ' . esc_html($city) . '</p>';
        }

        // Extract text from views
        $views = $p['views'] ?? array();
        if (is_array($views) && count($views) > 0) {
            $content .= '<h4>Sign Messages:</h4>';
            foreach ($views as $view) {
                if (isset($view['textLines']) && is_array($view['textLines'])) {
                    $content .= '<p>' . esc_html(implode(' ', $view['textLines'])) . '</p>';
                }
            }
        }

        $existing = get_posts(array(
            'post_type' => MN511_SIGN_POST_TYPE,
            'post_status' => array('publish', 'draft', 'pending', 'private', 'trash'),
            'meta_key' => MN511_ALERT_UID_META,
            'meta_value' => $uid,
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ));

        $post_data = array(
            'post_title' => $title,
            'post_content' => $content,
            'post_status' => 'publish',
            'post_type' => MN511_SIGN_POST_TYPE,
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
            update_post_meta($post_id, MN511_ALERT_FETCHED_META, $fetched_at);
            update_post_meta($post_id, MN511_ALERT_RAW_META, wp_json_encode($feature));
            update_post_meta($post_id, '_mn511_sign_status', $sign_status);
            update_post_meta($post_id, '_mn511_route', $route);
        }
    }
}

// Shortcode to render a list
function mn511_shortcode($atts) {
    $atts = shortcode_atts(array('endpoint' => 'alerts'), $atts);
    $cache = get_transient('mn511_cache');

    if (empty($cache['endpoints'][$atts['endpoint']])) {
        return '<div class="mn511-no-data">No data available for ' . esc_html($atts['endpoint']) . '.</div>';
    }

    $endpoint_data = $cache['endpoints'][$atts['endpoint']];
    $items = $endpoint_data['items'] ?? $endpoint_data;

    if (empty($items) || !is_array($items)) {
        return '<div class="mn511-no-data">No data available.</div>';
    }

    $endpoint_fetched = $endpoint_data['fetched_at'] ?? $cache['fetched_at'] ?? null;
    $endpoint_fetched = mn511_format_iso_string($endpoint_fetched) ?? $endpoint_fetched;

    $out = '<div class="mn511-container">';
    $out .= '<div class="mn511-fetched">Last updated: ' . esc_html($endpoint_fetched ?? 'unknown') . '</div>';
    $out .= '<ul class="mn511-list">';

    foreach ($items as $feature) {
        $p = $feature['properties'] ?? array();
        $title = esc_html($p['title'] ?? 'Item');
        $tooltip = isset($p['tooltip']) ? wp_kses_post($p['tooltip']) : '';
        $updated_raw = mn511_extract_updated_ms($feature);
        $updated_display = mn511_format_timestamp($updated_raw);
        $timestamp_html = $updated_display ? '<div class="mn511-timestamp">Updated: ' . esc_html($updated_display) . '</div>' : '';

        $out .= '<li class="mn511-item">';
        $out .= '<strong class="mn511-title">' . $title . '</strong>';
        if ($tooltip) {
            $out .= '<div class="mn511-tooltip">' . $tooltip . '</div>';
        }
        $out .= $timestamp_html;
        $out .= '</li>';
    }

    $out .= '</ul>';
    $out .= '</div>';

    return $out;
}

add_shortcode('mn511', 'mn511_shortcode');
add_shortcode('mn511_alerts', 'mn511_shortcode');
add_shortcode('mn511_weather', function($atts) {
    $atts['endpoint'] = 'weather-stations';
    return mn511_shortcode($atts);
});
add_shortcode('mn511_signs', function($atts) {
    $atts['endpoint'] = 'signs';
    return mn511_shortcode($atts);
});

// Add basic CSS
function mn511_enqueue_styles() {
    if (is_admin()) {
        return;
    }
    wp_add_inline_style('wp-block-library', '
        .mn511-container {
            margin: 20px 0;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 4px;
        }
        .mn511-fetched {
            font-size: 0.9em;
            color: #666;
            margin-bottom: 10px;
        }
        .mn511-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .mn511-item {
            padding: 10px;
            margin-bottom: 10px;
            background: #fff;
            border-left: 3px solid #0073aa;
            border-radius: 2px;
        }
        .mn511-title {
            display: block;
            margin-bottom: 5px;
            color: #0073aa;
        }
        .mn511-tooltip {
            margin: 5px 0;
            color: #333;
        }
        .mn511-timestamp {
            font-size: 0.85em;
            color: #888;
            margin-top: 5px;
        }
        .mn511-no-data {
            padding: 15px;
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            color: #856404;
        }
    ');
}
add_action('wp_enqueue_scripts', 'mn511_enqueue_styles');
