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
      console.error(":x: Token exchange failed:", tokenData);
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
    // 2.5 Get event types (to find interview + prep event IDs)
    const eventRes = await fetch(`https://api.calendly.com/event_types?user=${user.uri}`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json"
      }
    });
    const eventTypeData = await eventRes.json();
    const events = eventTypeData.collection || [];
    const interview = events.find(e =>
      e.name.toLowerCase().includes("interview")
    );
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
    // 4. Build request to either update or create a new record
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
          "Pre-Production Event ID": preProduction?.uri || "",
        }
      })
    });
    const airtableData = await airtableRes.json();
    if (!airtableRes.ok) {
      console.error(":x: Airtable error:", airtableData);
      return res.status(500).send("Failed to store token in Airtable.");
    }
    console.log(":white_check_mark: Calendly OAuth + Airtable sync complete");
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:tada: *${user.name || "A client"}* just connected Calendly!\n:e-mail: ${user.email || "No email found"}`
      })
    });
    // 5. Register webhook for new bookings
    try {
      const webhookPayload = {
        url: "https://hook.us1.make.com/zf9b4sf2rgqxbsxygjfn1w39mbeax52a",
        events: ["invitee.created"]
      };
    
      // Determine scope and identifier
      let scope = "";
      let scopeParam = "";
      if (user.current_organization) {
        scope = "organization";
        scopeParam = `organization=${user.current_organization}`;
        webhookPayload.organization = user.current_organization;
      } else if (user.uri) {
        scope = "user";
        scopeParam = `user=${user.uri}`;
        webhookPayload.user = user.uri;
      } else {
        throw new Error(":x: No organization or user URI found for webhook registration.");
      }
    
      // Step 1: Check existing webhooks
      const existingHooksRes = await fetch(`https://api.calendly.com/webhook_subscriptions?scope=${scope}&${scopeParam}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        }
      });
    
      const existingHooksData = await existingHooksRes.json();
      const existingWebhook = (existingHooksData.collection || []).find(hook =>
        hook.url === webhookPayload.url
      );
    
      if (existingWebhook) {
        console.log(":white_check_mark: Webhook already exists, skipping registration.");
      } else {
        // Step 2: Register a new webhook with expiration (2 years from now)
        const expirationDate = new Date();
        expirationDate.setFullYear(expirationDate.getFullYear() + 2);
        webhookPayload.expiration_date = expirationDate.toISOString();
    
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
          console.error(":x: Webhook registration failed:", webhookData);
        } else {
          console.log(":white_check_mark: Webhook registered:", webhookData);
        }
      }
    } catch (err) {
      console.error(":x: Error managing webhook:", err.message || err);
    }
};
