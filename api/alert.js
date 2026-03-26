// Vercel Serverless Function — Signup notification to Roby
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, domain, isCompetitor } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const flag = isCompetitor ? ' [COMPETITOR]' : '';
  const subject = `RateBlaster Signup${flag}: ${name || email}`;
  const text = `New signup on RateBlaster:\n\nName: ${name}\nEmail: ${email}\nDomain: ${domain || 'N/A'}${isCompetitor ? '\n\n*** COMPETITOR DOMAIN DETECTED ***' : ''}`;

  try {
    await resend.emails.send({
      from: 'McAbee Rate Blaster <info@mcabeegroup.com>',
      to: 'robdorsett@gmail.com',
      subject,
      text,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Alert email failed:', err);
    return res.status(500).json({ error: 'Failed to send alert' });
  }
};
