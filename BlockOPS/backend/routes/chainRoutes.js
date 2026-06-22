const express = require('express');
const router = express.Router();
const {
  getTransaction,
  getBlock,
  getEvents,
  decodeCalldata,
  decodeRevert,
  getAddressTxs
} = require('../controllers/chainController');

// GET /chain/tx/:hash
router.get('/tx/:hash', getTransaction);

// GET /chain/block/:number   (use "latest" for latest block)
router.get('/block/:number', getBlock);

// POST /chain/events
router.post('/events', getEvents);

// POST /chain/decode/calldata
router.post('/decode/calldata', decodeCalldata);

// POST /chain/decode/revert
router.post('/decode/revert', decodeRevert);

// GET /chain/address/:address/txs
router.get('/address/:address/txs', getAddressTxs);

module.exports = router;
