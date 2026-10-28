'use strict';
const path = require('node:path');
const express = require('express');
const { apiRouter } = require('./routes/api');

function createApp(store) {
  const app = express();
  app.disable('x-powered-by');

  // Basic security headers (no extra dependency needed)
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  // One log line per request, so CloudWatch can pick it up later
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log(JSON.stringify({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }));
      }
    });
    next();
  });

  app.use('/api', apiRouter(store));
  const modules = path.join(__dirname, '..', '..', 'node_modules');
  app.use('/vendor/gsap', express.static(path.join(modules, 'gsap', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/lenis', express.static(path.join(modules, 'lenis', 'dist'), { maxAge: '7d' }));
  app.use('/vendor', express.static(path.join(modules, 'chart.js', 'dist'), { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

  // Errors: known HttpErrors keep their message; anything else is logged and hidden from the client
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(JSON.stringify({ level: 'error', path: req.path, message: err.message }));
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });

  return app;
}

module.exports = { createApp };
