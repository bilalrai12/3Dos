const { jwtDecode } = require("jwt-decode");
const { loadData, saveJson, saveData } = require("./utils");

const main = async () => {
  const tokens = loadData("tokens.txt");
  const accounts = loadData("data.txt");
  const emails = accounts.map((acc) => {
    const [email, pass] = acc.split("|");
    return email;
  });
  if (tokens.length == 0) {
    console.error("Tokens not found in tokens.txt");
    return;
  }

  try {
    for (const token of tokens) {
      const decodedToken = jwtDecode(token);
      const { email } = decodedToken;
      if (!emails.includes(email)) {
        accounts.push(`${email}|pass`);
      }
      await saveJson(
        email,
        JSON.stringify({
          access_token: token,
        }),
        "localStorage.json"
      );
      await saveData(accounts, "data.txt");
    }
  } catch (error) {
    console.error("Error decoding JWT:", error);
  }
  console.log("Tokens saved to localStorage.json");
};

main();
