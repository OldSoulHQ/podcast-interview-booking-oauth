export default async function handler(req, res) {
  try {
    const airtableBaseId = process.env.AIRTABLE_BASE_ID;
    const airtableApiKey = process.env.AIRTABLE_API_KEY;
    const calendlyClientId = process.env.CALENDLY_CLIENT_ID;
    const calendlyClientSecret = process.env.CALENDLY_CLIENT_SECRET;

    // 1. Fetch all host records from Airtable
    const airtableRes = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/Hosts`, {
      headers: {
        Authorization: `Bearer ${airtableApiKey}`,
        "Content-Type": "application/json"
      }
    });

    const airtableData = await airtableRes.json();
    const hosts = airtableData.records || [];

    // 2. Loop through each host and refresh token if refresh_token exists
    for (const host of hosts) {
      const refreshToken = host.fields["Refresh Token"];
      if (!refreshToken) continue;

      // Exchange refresh_token for new access_token
      const tokenRes = await fetch("https://auth.calendly.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: calendlyClientId,
          client_secret: calendlyClientSecret
        })
      });

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        console.error(`❌ Failed to refresh token for ${host.fields["Email"] || host.id}:`, tokenData);
        continue;
      }

      // Update the record in Airtable
      const updateRes = await fetch(`https://api.airtable.com/v0/${airtableBaseId}/Hosts/${host.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${airtableApiKey}`,
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

      const updateData = await updateRes.json();

      if (!updateRes.ok) {
        console.error(`❌ Failed to update Airtable for ${host.id}:`, updateData);
      } else {
        console.log(`✅ Refreshed token for ${host.fields["Email"] || host.id}`);
      }
    }

    res.status(200).json({ success: true, message: "Token refresh job completed." });
  } catch (error) {
    console.error("❌ Unexpected error in refresh job:", error);
    res.status(500).json({ success: false, error: error.message || "Unknown error" });
  }
}
