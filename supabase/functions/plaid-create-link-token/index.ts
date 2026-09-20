

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Browser CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers:corsHeaders});
  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase configuration missing");
    }

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authHeader,
        apikey: supabaseKey,
      },
    });

    if (!userResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Invalid login" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const user = await userResponse.json();
    const body=await req.json().catch(()=>({}));
    const redirect=Deno.env.get("PLAID_IOS_REDIRECT_URI");
    if(body.platform==="ios"&&!redirect)return Response.json({error:"Native bank linking requires the configured Plaid iOS Universal Link."},{status:503,headers:corsHeaders});

    const clientId = Deno.env.get("PLAID_CLIENT_ID");

    const plaidEnv = Deno.env.get("PLAID_ENV") ?? "sandbox";

    const secret =
      plaidEnv === "sandbox"
        ? Deno.env.get("PLAID_SANDBOX_SECRET")
        : Deno.env.get("PLAID_SECRET");

    if (!clientId || !secret) {
      throw new Error("Plaid credentials are missing");
    }

    const plaidBaseUrl =
      plaidEnv === "production"
        ? "https://production.plaid.com"
        : "https://sandbox.plaid.com";

    const plaidResponse = await fetch(`${plaidBaseUrl}/link/token/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(body.platform==="ios"?{redirect_uri:redirect}:{}),
        client_id: clientId,
        secret,
        client_name: "Budget Live",
        language: "en",
        country_codes: ["US"],
        products: ["transactions"],
        user: {
          client_user_id: user.id,
        },
      }),
    });

    const data = await plaidResponse.json();

    if (!plaidResponse.ok) {
      console.error("Plaid Link request failed");

      return new Response(
        JSON.stringify({
          error: "Plaid request failed",
        }),
        {
          status: plaidResponse.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch {
    console.error("Plaid Link unavailable");

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});