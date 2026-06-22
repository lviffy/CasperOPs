const express = require('express');
const router  = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const {
  createSchedule,
  listSchedules,
  getSchedule,
  cancelSchedule,
  pauseSchedule,
  resumeSchedule
} = require('../controllers/scheduleController');

// POST   /schedule/transfer    — create a new scheduled transfer
router.post('/transfer', apiKeyAuth(), createSchedule);

// GET    /schedule             — list all scheduled transfers
router.get('/', apiKeyAuth({ optional: true }), listSchedules);

// GET    /schedule/:id         — get a single job
router.get('/:id', apiKeyAuth({ optional: true }), getSchedule);

// DELETE /schedule/:id         — cancel a job
router.delete('/:id', apiKeyAuth({ optional: true }), cancelSchedule);

// POST   /schedule/:id/pause   — pause a recurring job
router.post('/:id/pause', apiKeyAuth(), pauseSchedule);

// POST   /schedule/:id/resume  — resume a paused job
router.post('/:id/resume', apiKeyAuth(), resumeSchedule);

module.exports = router;
