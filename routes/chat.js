// Chat Routes — chatbot endpoint
const express = require('express');
const router = express.Router();
const chatbotService = require('../services/chatbotService');

// POST /api/chat — Send message, receive response
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await chatbotService.processMessage(message.trim());

    res.json({
      reply: response.reply,
      suggestions: response.suggestions || [],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({
      reply: 'Sorry, I encountered an error. Please try again.',
      suggestions: ['help', 'Status today'],
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
