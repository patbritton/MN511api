# Implementation Summary

This document summarizes the troubleshooting and resolution of an issue where a web map was not displaying data from its corresponding API.

## Problem
The web map application was not displaying any data on the map. The frontend was unable to fetch data from the backend API. This was caused by a combination of issues, including incorrect environment variable settings, SSL certificate validation errors, and upstream server errors.

## Investigation
1.  **Frontend Analysis:**
    *   Examined `web/index.html` and `web/assets/app.js`.
    *   Determined the frontend is a Leaflet map that fetches data from a backend API.
    *   Identified that when running locally, the frontend tries to connect to an API at `http://localhost:8787`.

2.  **Backend Analysis:**
    *   Examined `src/index.js`, `src/config.js`, `src/routes/events.js`, and `package.json`.
    *   The backend is a Node.js application using the Fastify framework.
    *   The server is configured to run on port `8787`.
    *   The application requires a `MN511_GRAPHQL_URL` environment variable to be set, which is the source of the 511 data.
    *   The application's CORS (Cross-Origin Resource Sharing) policy is configured via a `CORS_ORIGIN` environment variable.
    *   Analysis of server logs revealed `DEPTH_ZERO_SELF_SIGNED_CERT` errors, indicating that the Node.js HTTP client was rejecting the self-signed certificate from the `MN511_GRAPHQL_URL`.
    *   Further analysis of server logs revealed `502 Bad Gateway` errors from the `MN511_GRAPHQL_URL`, indicating an issue with the upstream server.

## Root Cause
The root cause of the issue was a multi-faceted misconfiguration of the backend server and issues with the external API:
1.  **Missing/Incorrect Environment Variables:** The `MN511_GRAPHQL_URL` and `CORS_ORIGIN` environment variables were not set correctly for a local development environment.
2.  **SSL Certificate Validation:** The `graphql.mn511.org` server is using a self-signed certificate, which the Node.js HTTP client was rejecting by default.
3.  **Upstream Server Errors:** The `graphql.mn511.org` server was returning `502 Bad Gateway` errors, indicating a problem on their end.

## Solution
1.  **Created and Updated a `.env` file:** A `.env` file was created and updated in the root of the project to provide the necessary environment variables.
    ```
    MN511_GRAPHQL_URL=https://graphql.mn511.org/
    CORS_ORIGIN=http://localhost:8788,http://127.0.0.1:8788
    NODE_TLS_REJECT_UNAUTHORIZED=0
    ```
    - `NODE_TLS_REJECT_UNAUTHORIZED=0` was added to bypass the self-signed certificate validation for development purposes.

2.  **Updated `README.md`:** The `README.md` file was updated to provide clear and accurate setup instructions, including how to create and configure the `.env` file with all necessary variables.

3.  **Added Retry Mechanism and Logging:** The `src/services/fetch511.js` file was modified to include a retry mechanism to make the application more resilient to transient upstream server errors. Logging of the GraphQL query and variables was also added to aid in debugging.

## Instructions to Run the Application
1.  **Start the backend server:**
    ```bash
    npm start
    ```
2.  **Start the frontend server (in a new terminal):**
    ```bash
    node web/serve.js
    ```
3.  **Access the application:**
    Open a web browser and navigate to `http://localhost:8788`.
