module.exports = async function handler(req, res) {
  const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Hosts`;

  // 1. Get all Hosts with refresh tokens
  const fetchAll = await fetch(airtableUrl, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const { records } = await fetchAll.json();
  const updated = [];

  for (const record of records) {
    const email = record.fields.Email;
    const refreshToken = record.fields["Refresh Token"];
    if (!refreshToken) continue;

    try {
      // 2. Refresh token
      const tokenRes = await fetch("https://auth.calendly.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: process.env.CALENDLY_CLIENT_ID,
          client_secret: process.env.CALENDLY_CLIENT_SECRET
        })
      });

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        console.error(`❌ Failed to refresh for ${email}:`, tokenData);
        continue;
      }

      // 3. Update Airtable
      await fetch(`${airtableUrl}/${record.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            "Access Token": tokenData.access_token,
            "Refresh Token": tokenData.refresh_token,
            "Expires In": tokenData.expires_in,
            "Last Refreshed": new Date().toISOString()
          }
        })
      });

      updated.push(email);
      console.log(`✅ Refreshed Calendly token for: ${email}`);
    } catch (err) {
      console.error(`❌ Error processing ${email}:`, err.message);
    }
  }

  return res.status(200).json({ message: "Refresh job complete", updated });
};
