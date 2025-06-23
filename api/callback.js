module.exports = async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing 'code' from Calendly redirect.");
  }

  try {
    // 1. Exchange code for access token
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

    // 2. Get user info from Calendly
    const userInfoRes = await fetch("https://api.calendly.com/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json"
      }
    });

    const userInfoData = await userInfoRes.json();
    const user = userInfoData.resource || {};

    // 2.5 Get event types
    const eventRes = await fetch(`https://api.calendly.com/event_types?user=${user.uri}`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json"
      }
    });

    const eventTypeData = await eventRes.json();
    const events = eventTypeData.collection || [];

    const interview = events.find(e => e.name.toLowerCase().includes("interview"));
    const preProduction = events.find(e =>
      e.name.toLowerCase().includes("pre") || e.name.toLowerCase().includes("prep")
    );

    // 3. Check Airtable to see if user already exists
    const findRes = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Hosts?filterByFormula=Email="${user.email}"`, {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const findData = await findRes.json();
    const existingRecord = findData.records && findData.records[0];

    // 4. Create or update Airtable record
    const airtableUrl = existingRecord
      ? `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Hosts/${existingRecord.id}`
      : `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Hosts`;

    const method = existingRecord ? "PATCH" : "POST";

    const airtableRes = await fetch(airtableUrl, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "Name": user.name,
          "Email": user.email,
          "Access Token": tokenData.access_token,
          "Refresh Token": tokenData.refresh_token,
          "Expires In": tokenData.expires_in,
          "Connected At": new Date().toISOString(),
          "Interview Event ID": interview?.uri || "",
          "Pre-Production Event ID": preProduction?.uri || ""
        }
      })
    });

    const airtableData = await airtableRes.json();

    if (!airtableRes.ok) {
      console.error("❌ Airtable error:", airtableData);
      return res.status(500).send("Failed to store token in Airtable.");
    }

    console.log("✅ Calendly OAuth + Airtable sync complete");

    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🎉 *${user.name || "A client"}* just connected Calendly!\n📧 ${user.email || "No email found"}`
      })
    });

    // 5. Register webhook (with 2-year expiration and unique URL)
    try {
      const expirationDate = new Date();
      expirationDate.setFullYear(expirationDate.getFullYear() + 2);

      const webhookPayload = {
        url: `https://hook.us1.make.com/zf9b4sf2rgqxbsxygjfn1w39mbeax52a?user=${encodeURIComponent(user.uri)}`,
        events: ["invitee.created"],
        expiration_date: expirationDate.toISOString()
      };

      if (user.current_organization) {
        webhookPayload.organization = user.current_organization;
        webhookPayload.scope = "organization";
      } else if (user.uri) {
        webhookPayload.user = user.uri;
        webhookPayload.scope = "user";
      } else {
        throw new Error("❌ No organization or user URI found for webhook registration.");
      }

      const webhookRes = await fetch("https://api.calendly.com/webhook_subscriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(webhookPayload)
      });

      const webhookData = await webhookRes.json();

      if (!webhookRes.ok) {
        console.error("❌ Webhook registration failed:", webhookData);
      } else {
        console.log("✅ Webhook registered:", webhookData);
      }

    } catch (err) {
      console.error("❌ Error registering webhook:", err.message || err);
    }

    res.status(200).send("Calendly setup complete.");

  } catch (err) {
    console.error("❌ Outer error caught:", err.message || err);
    res.status(500).send("Internal Server Error during Calendly setup.");
  }
};
