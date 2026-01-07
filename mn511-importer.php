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
define('MN511_FAVORITES_META', '_mn511_favorites');
define('MN511_AUTH_TOKEN_META', '_mn511_auth_token_hash');
define('MN511_AUTH_TOKEN_EXPIRES_META', '_mn511_auth_token_expires');
define('MN511_AUTH_TOKEN_TTL', 30 * DAY_IN_SECONDS);

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

function mn511_get_authorization_header() {
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    return '';
}

function mn511_get_bearer_token() {
    $header = mn511_get_authorization_header();
    if (!$header) {
        return null;
    }
    if (preg_match('/Bearer\s+(.+)/i', $header, $matches)) {
        return trim($matches[1]);
    }
    return null;
}

function mn511_get_user_by_token($token) {
    if (empty($token)) {
        return null;
    }
    $hash = hash('sha256', $token);
    $users = get_users(array(
        'meta_key' => MN511_AUTH_TOKEN_META,
        'meta_value' => $hash,
        'number' => 1,
        'fields' => 'all',
    ));

    if (empty($users)) {
        return null;
    }

    $user = $users[0];
    $expires = get_user_meta($user->ID, MN511_AUTH_TOKEN_EXPIRES_META, true);
    if ($expires && is_numeric($expires) && (int) $expires < time()) {
        delete_user_meta($user->ID, MN511_AUTH_TOKEN_META);
        delete_user_meta($user->ID, MN511_AUTH_TOKEN_EXPIRES_META);
        return null;
    }

    return $user;
}

function mn511_require_auth($request) {
    $token = mn511_get_bearer_token();
    if (!$token) {
        return new WP_Error('mn511_auth_required', 'Authentication required.', array('status' => 401));
    }

    $user = mn511_get_user_by_token($token);
    if (!$user) {
        return new WP_Error('mn511_auth_invalid', 'Invalid or expired token.', array('status' => 403));
    }

    wp_set_current_user($user->ID);
    return true;
}

function mn511_sanitize_favorite($favorite) {
    if (!is_array($favorite)) {
        return null;
    }

    $id = sanitize_text_field($favorite['id'] ?? '');
    if (empty($id)) {
        return null;
    }

    $coords = null;
    if (!empty($favorite['coordinates']) && is_array($favorite['coordinates']) && count($favorite['coordinates']) === 2) {
        $lat = floatval($favorite['coordinates'][0]);
        $lon = floatval($favorite['coordinates'][1]);
        if (is_finite($lat) && is_finite($lon)) {
            $coords = array($lat, $lon);
        }
    }

    return array(
        'id' => $id,
        'layerId' => sanitize_text_field($favorite['layerId'] ?? ''),
        'title' => sanitize_text_field($favorite['title'] ?? 'Favorite'),
        'subtitle' => sanitize_text_field($favorite['subtitle'] ?? ''),
        'icon' => sanitize_text_field($favorite['icon'] ?? ''),
        'updatedAt' => sanitize_text_field($favorite['updatedAt'] ?? ''),
        'coordinates' => $coords,
        'createdAt' => sanitize_text_field($favorite['createdAt'] ?? ''),
    );
}

function mn511_get_favorites_for_user($user_id) {
    $favorites = get_user_meta($user_id, MN511_FAVORITES_META, true);
    if (!is_array($favorites)) {
        return array();
    }
    return array_values(array_filter($favorites));
}

function mn511_save_favorites_for_user($user_id, $favorites) {
    update_user_meta($user_id, MN511_FAVORITES_META, array_values($favorites));
}

function mn511_rest_login($request) {
    $username = $request->get_param('username');
    $password = $request->get_param('password');

    if (empty($username) || empty($password)) {
        return new WP_Error('mn511_login_missing', 'Username and password are required.', array('status' => 400));
    }

    $user = wp_authenticate($username, $password);
    if (is_wp_error($user)) {
        return new WP_Error('mn511_login_failed', 'Invalid credentials.', array('status' => 403));
    }

    $token = wp_generate_password(48, false, false);
    $hash = hash('sha256', $token);

    update_user_meta($user->ID, MN511_AUTH_TOKEN_META, $hash);
    update_user_meta($user->ID, MN511_AUTH_TOKEN_EXPIRES_META, time() + MN511_AUTH_TOKEN_TTL);

    return array(
        'token' => $token,
        'user' => array(
            'id' => $user->ID,
            'name' => $user->display_name,
            'username' => $user->user_login,
            'email' => $user->user_email,
        ),
    );
}

function mn511_rest_logout($request) {
    $token = mn511_get_bearer_token();
    if (!$token) {
        return new WP_Error('mn511_auth_required', 'Authentication required.', array('status' => 401));
    }

    $user = mn511_get_user_by_token($token);
    if (!$user) {
        return new WP_Error('mn511_auth_invalid', 'Invalid token.', array('status' => 403));
    }

    delete_user_meta($user->ID, MN511_AUTH_TOKEN_META);
    delete_user_meta($user->ID, MN511_AUTH_TOKEN_EXPIRES_META);

    return array('ok' => true);
}

function mn511_rest_get_favorites($request) {
    $user = wp_get_current_user();
    $favorites = mn511_get_favorites_for_user($user->ID);
    return array('favorites' => $favorites);
}

function mn511_rest_add_favorite($request) {
    $user = wp_get_current_user();
    $payload = $request->get_json_params();
    $favorite = mn511_sanitize_favorite($payload['favorite'] ?? null);
    if (!$favorite) {
        return new WP_Error('mn511_favorite_invalid', 'Favorite payload is invalid.', array('status' => 400));
    }

    if (empty($favorite['createdAt'])) {
        $favorite['createdAt'] = gmdate('c');
    }

    $favorites = mn511_get_favorites_for_user($user->ID);
    $updated = false;
    foreach ($favorites as $index => $existing) {
        if (!empty($existing['id']) && $existing['id'] === $favorite['id']) {
            $favorites[$index] = array_merge($existing, $favorite);
            $updated = true;
            break;
        }
    }
    if (!$updated) {
        $favorites[] = $favorite;
    }

    mn511_save_favorites_for_user($user->ID, $favorites);
    return array('favorites' => $favorites, 'favorite' => $favorite);
}

function mn511_rest_remove_favorite($request) {
    $user = wp_get_current_user();
    $id = sanitize_text_field($request['id'] ?? '');
    if (empty($id)) {
        return new WP_Error('mn511_favorite_missing', 'Favorite id is required.', array('status' => 400));
    }

    $favorites = mn511_get_favorites_for_user($user->ID);
    $favorites = array_values(array_filter($favorites, function ($fav) use ($id) {
        return isset($fav['id']) && $fav['id'] !== $id;
    }));

    mn511_save_favorites_for_user($user->ID, $favorites);
    return array('favorites' => $favorites);
}

function mn511_rest_cors_headers($served, $result, $request, $server) {
    $route = $request->get_route();
    if (strpos($route, '/mn511/v1/') === false) {
        return $served;
    }

    $origin = get_http_origin();
    if ($origin) {
        header('Access-Control-Allow-Origin: ' . esc_url_raw($origin));
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
    }

    return $served;
}
add_filter('rest_pre_serve_request', 'mn511_rest_cors_headers', 10, 4);

function mn511_register_rest_routes() {
    register_rest_route('mn511/v1', '/login', array(
        'methods' => 'POST',
        'callback' => 'mn511_rest_login',
        'permission_callback' => '__return_true',
    ));

    register_rest_route('mn511/v1', '/logout', array(
        'methods' => 'POST',
        'callback' => 'mn511_rest_logout',
        'permission_callback' => 'mn511_require_auth',
    ));

    register_rest_route('mn511/v1', '/favorites', array(
        array(
            'methods' => 'GET',
            'callback' => 'mn511_rest_get_favorites',
            'permission_callback' => 'mn511_require_auth',
        ),
        array(
            'methods' => 'POST',
            'callback' => 'mn511_rest_add_favorite',
            'permission_callback' => 'mn511_require_auth',
        ),
    ));

    register_rest_route('mn511/v1', '/favorites/(?P<id>[a-zA-Z0-9_\\-:.]+)', array(
        'methods' => 'DELETE',
        'callback' => 'mn511_rest_remove_favorite',
        'permission_callback' => 'mn511_require_auth',
    ));
}
add_action('rest_api_init', 'mn511_register_rest_routes');
