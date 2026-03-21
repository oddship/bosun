import express from "express";
import _ from "lodash";
import axios from "axios";

const app = express();

app.get("/api/users", async (req, res) => {
  const response = await axios.get("https://jsonplaceholder.typicode.com/users");
  const sorted = _.sortBy(response.data, "name");
  res.json(sorted);
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

export default app;
