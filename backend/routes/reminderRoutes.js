const express = require('express');
const {
  createReminder,
  listReminders,
  getReminder,
  cancelReminder
} = require('../controllers/reminderController');

const router = express.Router();

router.post('/', createReminder);
router.get('/', listReminders);
router.get('/:id', getReminder);
router.delete('/:id', cancelReminder);

module.exports = router;
