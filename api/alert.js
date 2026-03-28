// Vercel Serverless Function — Signup notification to Roby
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name, domain, isCompetitor, phone, rateTypes } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const flag = isCompetitor ? ' ⚠️ COMPETITOR' : '';
  const subject = `RateBlaster Signup${flag}: ${name || email}`;
  const lines = [
    `New signup on RateBlaster:`,
    ``,
    `Name: ${name || '(none)'}`,
    `Email: ${email}`,
    `Phone: ${phone || '(none)'}`,
    `Domain: ${domain || 'N/A'}`,
    `Rate Types: ${Array.isArray(rateTypes) ? rateTypes.join(', ') : 'N/A'}`,
  ];
  if (isCompetitor) {
    lines.push('', '⚠️⚠️⚠️ COMPETITOR DOMAIN DETECTED ⚠️⚠️⚠️');
  }
  const text = lines.join('\n');

  const recipients = ['robdorsett@gmail.com', 'kevin@sfmghuntsville.com'];

  try {
    for (const to of recipients) {
      await resend.emails.send({
        from: 'McAbee Rate Blaster <info@mcabeegroup.com>',
        to,
        subject,
        text,
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Alert email failed:', err);
    return res.status(500).json({ error: 'Failed to send alert' });
  }
};
