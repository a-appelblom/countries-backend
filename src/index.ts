import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { Client } from "pg";
import z from "zod";
import dotenv from "dotenv";
import { cors } from "hono/cors";
import { sign, jwt } from "hono/jwt";
import { setCookie } from "hono/cookie";
import bc from "bcrypt";

dotenv.config();

type User = {
  username: string;
  password: string;
};
const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error("JWT_SECRET not set");
}

// const connectionString = process.env.DB_URL;
// const db = new Client({ connectionString });

// Temporary in-memory storage
const users: User[] = [];

const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string().min(6).max(100),
});

type Currency = {
  name: string;
  symbol: string;
};

type CurrencyCode = string;

export type CountryData = {
  name: string;
  currencies?: Record<CurrencyCode, Currency>;
  population?: number;
  exchangeRates: Record<CurrencyCode, number>;
};

const COUNTRY_API = "https://restcountries.com/v3.1";
const FIXER_API = "http://data.fixer.io/api";

const app = new Hono();
app.use("*", cors());
app.use(
  "/api/*",
  jwt({
    secret,
    cookie: "token",
  })
);

app.get("/api/name/:name", async (c) => {
  const name = c.req.param("name");

  const data = await fetch(`${COUNTRY_API}/name/${name}`);

  if (!data.ok) {
    return c.text("Country not found", 404);
  }

  const parsedDataArray = await data.json();
  const parsedData = parsedDataArray[0];

  if (!parsedData) {
    return c.text("Country not found", 404);
  }

  const country: CountryData = {
    name: parsedData.name.common,
    currencies: parsedData.currencies,
    population: parsedData.population,
    exchangeRates: {},
  };

  if (!country.currencies) {
    return c.json(country);
  }

  for await (const curr of Object.keys(country.currencies)) {
    const endpoint = "/latest";
    const requestString = `${FIXER_API}${endpoint}?access_key=${process.env.FIXER_KEY}&symbols=${curr},SEK`;
    const res = await fetch(requestString, { referrerPolicy: "unsafe-url" });
    const parsedRes = await res.json();
    const sek = parsedRes.rates.SEK;
    const currRate = parsedRes.rates[curr];
    const exchangeRate = currRate / sek;
    country.exchangeRates[curr] = exchangeRate;
  }

  return c.json(country);
});

// For simplicity i reused the login endpoint as a register endpoint.
// If there is no user with the given username, a new user is created.
app.post("/login", zValidator("json", loginRequestSchema), async (c) => {
  const { username, password } = c.req.valid("json");
  let user = users.find((u) => u.username === username);

  if (!user) {
    const hash = bc.hashSync(password, 10);
    user = { username, password: hash };
    users.push(user);
  }

  if (!user) {
    return c.text("Invalid username or password", 401);
  }

  const match = bc.compareSync(password, user.password);

  if (!match) {
    return c.text("Invalid username or password", 401);
  }

  if (!user) {
    return c.text("Invalid username or password", 401);
  }

  setCookie(c, "token", await sign({ username: user.username }, secret), {
    maxAge: 60 * 60 * 24 * 7,
    secure: false,
    httpOnly: true,
  });
  return c.json({ token: await sign({ username: user.username }, secret) });
});

app.post("/save-country", async (c) => {
  return c.text("Country saved");
});

serve(app);
