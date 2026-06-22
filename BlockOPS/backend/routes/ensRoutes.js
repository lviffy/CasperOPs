const express = require('express');
const router = express.Router();
const { resolveName, reverseLookup, resolveMany } = require('../controllers/ensController');

// GET /ens/resolve/:name       — e.g. /ens/resolve/vitalik.eth
router.get('/resolve/:name', resolveName);

// GET /ens/reverse/:address    — e.g. /ens/reverse/0xd8dA6...
router.get('/reverse/:address', reverseLookup);

// POST /ens/resolve-many       — batch resolve up to 20 names
router.post('/resolve-many', resolveMany);

module.exports = router;
