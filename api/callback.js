export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing 'code' from Calendly redirect.");
  }

  try {
    const tokenResponse = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.CALENDLY_CLIENT_ID,
        client_secret: process.env.CALENDLY_CLIENT_SECRET,
        redirect_uri: "https://oldsoul-podcast-interview-booking-oauth.vercel.app/api/callback",
        code: code
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("❌ Token exchange failed:", tokenData);
      return res.status(500).send(`Token exchange failed: ${tokenData.error || "unknown error"}`);
    }

    // Store in Airtable
    const airtableRes = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent("Clients")}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "Access Token": tokenData.access_token,
          "Refresh Token": tokenData.refresh_token,
          "Expires In": tokenData.expires_in,
          "Connected At": new Date().toISOString()
        }
      })
    });

    const airtableData = await airtableRes.json();

    if (!airtableRes.ok) {
      console.error("❌ Airtable error:", airtableData);
      return res.status(500).send("Failed to store token in Airtable.");
    }

    console.log("✅ Stored token in Airtable:", airtableData);
    res.status(200).send("🎉 OAuth successful! Token stored in Airtable.");
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    res.status(500).send("Server error during OAuth process.");
  }
}
