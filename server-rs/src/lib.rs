//! File Browser: browse a folder from any browser or from the desktop window, with readers for
//! PDFs, comics, EPUBs, archives, videos and more. Serves the web app in public/ and its JSON API.
//! Two programs use this library: `filebrowser` (the server, for a terminal) and
//! `filebrowser-app` (the same server inside its own window).

// Handlers return a ready HTTP response as their error value, so Err variants are large by design.
#![allow(clippy::result_large_err)]
// `!(x > 0.0)` is used on purpose: like the JavaScript it ports, it also treats NaN as "no value".
#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod ai;
pub mod annotations;
pub mod app;
pub mod archives;
pub mod browse;
pub mod cache;
pub mod comics;
pub mod config;
pub mod credentials;
pub mod documents;
pub mod jsutil;
pub mod media;
pub mod mega;
pub mod panels;
pub mod routes;
pub mod security;
pub mod session;
pub mod thumbs;
pub mod util;
pub mod server;
pub mod tools;
