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

    if (tokenResponse.ok) {
      console.log("✅ Calendly OAuth Token:", tokenData);
      res.status(200).send("🎉 OAuth successful! You can now close this tab.");
    } else {
      console.error("❌ Token exchange failed:", tokenData);
      res.status(500).send(`Token exchange failed: ${tokenData.error || "unknown error"}`);
    }
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    res.status(500).send("Server error during OAuth process.");
  }
}
