'use strict';
const { createApp } = require('./app');
const { createStore } = require('./data');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp(createStore());
app.listen(PORT, HOST, () => console.log(`F1 Race Intelligence listening on http://${HOST}:${PORT}`));
