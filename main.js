const fs = require("fs");
const fsPromises = require("fs/promises");

const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents.js");
const settings = require("./config/config.js");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson, getRandomElement, generateRandomNumber } = require("./utils.js");
const { checkBaseUrl } = require("./checkAPI");
let intervalIds = [];

class ClientAPI {
  constructor(itemData, accountIndex, proxy, baseURL, localStorage) {
    this.extensionId = "chrome-extension://lhmminnoafalclkgcbokfcngkocoffcp";
    this.headers = {
      Accept: "*/*",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "none",
      Origin: "https://dashboard.3dos.io",
      Referer: "https://dashboard.3dos.io/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.baseURL = baseURL;
    this.baseURL_v2 = settings.BASE_URL_v2;

    this.itemData = itemData;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = null;
    this.authInfo = null;
    this.localStorage = localStorage;
    // this.wallet = getWalletFromPrivateKey(itemData.privateKey);
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.itemData.email;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[3DOS][Account ${this.accountIndex + 1}][${this.itemData.email}]`;
    let ipPrefix = "[Local IP]";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 2,
      isAuth: false,
      extraHeaders: {},
      refreshToken: null,
    }
  ) {
    const { retries, isAuth, extraHeaders, refreshToken } = options;

    const headers = {
      ...this.headers,
      ...extraHeaders,
    };

    if (!isAuth) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }
    let currRetries = 0,
      errorMessage = null,
      errorStatus = 0;

    do {
      try {
        const response = await axios({
          method,
          url,
          headers,
          timeout: 120000,
          ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
          ...(method.toLowerCase() != "get" ? { data } : {}),
        });
        if (response?.data?.data) return { status: response.status, success: true, data: response.data.data, error: null };
        return { success: true, data: response.data, status: response.status, error: null };
      } catch (error) {
        errorStatus = error.status;
        errorMessage = error?.response?.data?.status ? error?.response?.data : error.message;
        console.log(error?.response?.data);
        this.log(`Request failed: ${url} | Status: ${error.status} | ${JSON.stringify(errorMessage || {})}...`, "warning");

        if (error.status == 401) {
          this.log(`Unauthorized: ${url} | trying get new token...`);
          this.token = await this.getValidToken(true);
          return await this.makeRequest(url, method, data, options);
        }
        if (error.status == 400) {
          this.log(`Invalid request for ${url}, maybe have new update from server | contact: https://t.me/Bilalstudio2 to get new update!`, "error");
          return { success: false, status: error.status, error: errorMessage, data: null };
        }
        if (error.status == 429) {
          this.log(`Rate limit ${JSON.stringify(errorMessage)}, waiting 60s to retries`, "warning");
          await sleep(60);
        }
        if (currRetries > retries) {
          return { status: error.status, success: false, error: errorMessage, data: null };
        }
        currRetries++;
        await sleep(5);
      }
    } while (currRetries <= retries);
    return { status: errorStatus, success: false, error: errorMessage, data: null };
  }

  async auth() {
    const payload = {
      email: this.itemData.email,
      password: this.itemData.password,
    };
    return this.makeRequest(`${this.baseURL}/auth/login`, "post", payload, { isAuth: true });
  }

  async register() {
    //     {
    //     "email": "@gmail.com",
    //     "password": "@",
    //     "acceptTerms": true,
    //     "country_id": "233",
    //     "referred_by": " ",
    //     "captcha_token": "03AFcWeA4WwLhwdJwH_kh1CATjtWZhbtBXPgQq82fM_PYWE2ZLlwcZEMjyYoWAlK54KAlfjGo1Cy-wiBqnEn6-gQ5IdTZUzWeFhbadiH-ugLJP4eMqLr-r-Zc_-i_J4FKMCcBAVOAPPuibQxuYe8IoP2P5Gvbynb2-eyAo65lj1-w9iD_3zQB2TqCn4Qeu7AlhMFb2Jatx_R691fPnT-U8r3j5SJ2OwvIgTBowTtgHmBP13ICR5JDl-iS5bp8jaLtJMIKGjBdB_a9hD3iVDhblWhUELLYQjRW2gukIWwNcQxjc7nMWANBXVlba-rruUYYk3K29GxUoOaYqYwgnXPfrI-AN1c7_uSMWryAay2YZp_KExfh_Lkq0-HIgR6vjYMQB9FHUneTJpVHajUWHH8f4AG0yZgRdigAKwulVOW1dTW9OgCjtMox47BvKxjy4luIOz3XOn4AXL_DV9-Lqvbn1Nkc68FS28JFTkNQyNukF3pWeuef74lZT1R_E0wGX0Ssubs_HjpRF65zxtRhNur74Y3_L0uA31PhkSmKGubIyD7JqFFX6EYhjT4v4HEUapzXUYnJrAU-krXuqK-XqwSAVVE10T_vviUaFj8RaS9qW9ceLXR9nQyDtU2ozC2RYeCElvbLre6opIkQknTN29nefLkqjC8wNe9j-bu0M3l1ay0kBbgOrzVOTnAbCcUBhJP2W4mVeIO662QKyOJUv4gGRL8_xtH_3TscHpT2joDZmpJs_sy3dT-jS7D1MgcFD6Jr1oRVek-9RFr4_cjDNl2XiZlXSBk7pt7_txURXwYbKR_oqFScuFQodSwW2vywi2ETMNHKm3kRlRLCGqn7mDTzEHb2Umz5Zlla8z3TriM5DuZM6kt4ld7YCBGcWO0THcqTUJoKJxHQ5aXnfo-6CfdgkqJlnBwxKBfOWLXvIfjnLlzEN8-ev-1fxaM-mYDOOLNtxSTHtZ3hoVGxUwu1-Do_8uKHUki7u9LFsrBqw84nfItIVrzWwW4O8mlUF7XM2meWEvqAbav9uVvWKRkVBAb8VnSc2RFJqg2HdETgl2BlNuPopnTDTlocAZaiPn_RxvVaAiwqGLeboNKR8RVrfAjkM69S3m-SH8j4rlVCOB1ZeSrXVcoev5bKc_aJFAoobfS8z0aXrDjN7wQW99JO0iITsjvXe61d9ahIF2QLIBPd8GoKq3bdM_ad-5F641n-u3OAGOOkFY4GaxWQCtjBoN92EnF6D7bsXS4ohuRwg8ZUmo13x58t5U31YunbsUa_ZwQFj2VsS1iTgkQhrR87fzMCVxuR5i8fA5wmE-ahc2lWkxI0I8WE5wgHpJmWVz_3QfRR2gtb0ZLWbnaqTz8VU-yFvAsh69AeaJM7dOkrXwyw5PckbiGw6r8Xrl0JWCOis60Q-rdjNrtwNfO__UJ_nAsekB9auFYRFVBfYLvee2nnnXLqwsXnWeCccSzJZ8Bre7Y6gnrw4Y78Ngq7prJ0cfYrDkj-JFEwHlwVZQVjHxX4OooGAYU330tdjvB5rovY2ye2h6wTJ4A29qhMNBYjKjIQ-U_6LEWxit5WSfS0X4-3w4u17hX9FHBnBcKfmL11KBrmaitCfKuwy5pSugJw3Y5SC7U7EAZZDSy_yxDBCGL1uZMAmAqd0uR2ZqBSdNwWu86SLFUSdntldicAqkuQjBvbe0-H4gUKj0tTvfGdl8UUnr8KEbu2-96Rbaga0Lswr9L-8SMn0oknr-ePqHWNeI1yz0ethphlxkp0CExSsByEC9OaU7kksuiWIUgZzIgNfXWVpHxjZ-T9eBaFuvHxVXZuFUHwpatOKfIGk326BDtiI6so8QXVVkmwVmkPx3GptxFHCsuJQNF0di1I8cZVjS9pn7jU1BS6Ng7kA7H6KodbFaeThFiE9U3jZ7_PPQ0HO6rnb4LF7zndPNhviRqm_vRJb-D3WAobzAEy0PwnjjufVt_9RFGhz7yIxTdDmm32YbWPMczp2lcH7eks_DxLg0bxt8jodEuzYTQr6LVrH8OOtilxebjbDEirJH_1UxeHdhqUpYRKbiba9K8jaTP6hixoSRyVBzlAENmQYWwjWBXWXGsQRKerKzzLV8CL0rDSMGfFlh-i0AGv6NZhke_ZWhPx8wN-Q6We2Iwk2gw"
    // }
    return this.makeRequest(`${this.baseURL}/auth/login`, "post", payload, { isAuth: true });
  }

  async hb() {
    return this.makeRequest(
      `${this.baseURL}/profile/api/${this.itemData.api_secret}`,
      "post",
      {},
      {
        isAuth: true,
        extraHeaders: {
          Origin: "chrome-extension://lpindahibbkakkdjifonckbhopdoaooe",
          cookie: `3dosnetwork_session=tscGVFe8w7G4jdmGzNORbVxGaTXqnQyn4W9PS8df; _ga=GA1.1.979075208.1739771847; _ga_KRR6Y20E7B=GS1.1.1743848645.2.0.1743848645.60.0.101610976; accessToken=U2FsdGVkX1%252F9NHLxVWIL5sqijXZ6Waz9jaqPsQJBN54BUBwOifw4IEOzLQlSAhCe4wp1KcFYKHH8nGwrl3iQcWcqIm0NcuCsZ2hFrF9IlUR5R50RbjcG1v1DikX40C4sHMU%252BY0Vz85%252F84ma1WKRqEIJVuRm4%252F4b0BO%252FffJQkfg305DUG2EYVOof%252BlGDY7SQzJnTFJ6%252F4z5L1y1CZZDdqmIP%252FwTzqxCKNLMmnTSAnal5iGUQg3TGU6ecyo%252Fe57c4KJjUT5nu1BHeuiHBtzThL3BrTcwbtoUpYJ8XQnKNRWiAsWf09BAxQ1138GcbiMfbE9D%252Bhc%252B3Bj0oLj9bV3IVFWJVTmOf983U2%252Fd8LsZy4LzucxaGzOHzrkOwj0FagEQnFH3i9elBjDE7BWdYmxS7fbY541lnbtYD2WBtCeKsmQbzodbt1%252Bn1qEWh%252FkbHkfO1hh8tr00Bh9Iaos065CByiTERMGnCzJsp5n6OjUXGxbquold9VJWzL6Rq4tUzCPxLNdhTQVtkCQdGmy%252F5qR87I8sXofyGD2vSTQZdwkrmXj%252BQ%252F65BrzNOh0pwiGDPLgIQthNtdKBzHegCmqEO7nOe1hVWEqW2CXXaAuFSgsYtCkkuvcwqKRuERrnWm6A3BpA487xlCEYOjyTFjNurd1VOI1KP5XAUtfgl98zbh7B8%252Fl1L5cxtwGK83Z5A5qGZVPTbtftsaEuy1pgulr0MSVCl32A%253D%253D; userId=1101967; is_auth=U2FsdGVkX19j0wIanv64%252FzMVNIN0s%252FWf9SPdLsYPdyrnLLPXF29XwxMySYz2w8jt; _ga_SC9Q5VB8Y0=GS1.1.1743864018.1.0.1743864019.59.0.0; _ga_5VZE0YLSBN=GS1.1.1743863723.3.1.1743864056.0.0.0`,
        },
      }
    );
  }

  async getBalance() {
    return this.makeRequest(`${this.baseURL}/refresh-points/${this.itemData.api_secret}`, "get", null, {
      extraHeaders: {
        isAuth: true,
        Origin: "chrome-extension://lpindahibbkakkdjifonckbhopdoaooe",
      },
    });
  }

  async getUserData() {
    return this.makeRequest(`${this.baseURL}/profile/me`, "post", {});
  }

  async genarateKeySecret() {
    return this.makeRequest(`${this.baseURL}/profile/generate-api-key`, "post", {});
  }

  async applySecret() {
    return this.makeRequest(`${this.baseURL}/profile/api/${this.itemData.api_secret}`, "post", null);
  }

  async checkin() {
    return this.makeRequest(`${this.baseURL}/claim-reward`, "post", { id: "daily-reward-api" });
  }

  async getValidToken(isNew = false) {
    const existingToken = this.token;
    const { isExpired: isExp, expirationDate } = isTokenExpired(existingToken);

    this.log(`Access token status: ${isExp ? "Expired".yellow : "Valid".green} | Acess token exp: ${expirationDate}`);
    if (existingToken && !isNew && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    // if (this.authInfo?.refreshToken) {
    //   const { isExpired: isExpRe, expirationDate: expirationDateRe } = isTokenExpired(this.authInfo.refreshToken);
    //   this.log(`RefereshToken token status: ${isExpRe ? "Expired".yellow : "Valid".green} | RefereshToken token exp: ${expirationDateRe}`);
    //   if (!isExpRe) {
    //     const result = await this.getRefereshToken();
    //     if (result.data?.access_token) {
    //       saveJson(this.session_name, JSON.stringify(result.data), "localStorage.json");
    //       return result.data.access_token;
    //     }
    //   }
    // }

    this.log("No found token or experied...", "warning");
    const loginRes = await this.auth();
    if (!loginRes?.success) return null;
    const newToken = loginRes.data;
    if (newToken?.access_token) {
      await saveJson(this.session_name, JSON.stringify(newToken), "localStorage.json");
      return newToken.access_token;
    }
    this.log("Can't get new token...", "warning");
    return null;
  }

  async handleCheckPoint() {
    const balanceData = await this.getBalance();
    if (!balanceData.success) return this.log(`Can't sync new points...`, "warning");
    const total_points = balanceData.data?.total_points;
    console.log(balanceData.data);
    this.log(`${new Date().toLocaleString()} Total points: ${total_points} | Recheck after 5 minutes`, "custom");
  }

  async checkInvaliable(nextClaimTime) {
    const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds since Unix epoch
    const claimTime = new Date(nextClaimTime).getTime() / 1000; // Convert to Unix timestamp

    return currentTime >= claimTime; // Returns true if you can claim, false otherwise
  }

  async handleCheckin() {
    const resCheckin = await this.checkin();
    if (resCheckin.success) this.log(`Checkin success!`, "success");
    else {
      this.log(`Can't checkin | ${JSON.stringify(resCheckin)}`, "warning");
    }
  }
  async handleTasks() {
    this.log(`Checking tasks...`);
    let tasks = [];
    const tasksData = await this.getTasks();

    if (!tasksData.success && !dailytasks.success) {
      this.log("Can't get tasks...", "warning");
      return;
    }

    const tasksToComplete = tasksData.data.filter((task) => task.status != 1 && !settings.SKIP_TASKS.includes(task.taskId));

    if (tasksToComplete.length == 0) return this.log(`No tasks avaliable to do!`, "warning");
    for (const task of tasksToComplete) {
      await sleep(1);
      const { taskId, title } = task;

      this.log(`Completing task: ${taskId} | ${title}...`);
      const compleRes = await this.compleTask(taskId);

      if (compleRes.data?.statusCode == 200) this.log(`Task ${taskId} | ${title} complete successfully! | Reward: ${JSON.stringify(task.reward)}`, "success");
      else {
        this.log(`Can't complete task ${taskId} | ${title} | ${JSON.stringify(compleRes)}...`, "warning");
      }
    }
  }

  async handleSyncData() {
    this.log(`Sync data...`);
    let userData = { success: false, data: null, status: 0, error: null },
      retries = 0;

    do {
      userData = await this.getUserData();
      if (userData?.success) break;
      retries++;
    } while (retries < 1 && userData.status !== 400);
    if (userData?.success) {
      let { api_secret, email_verified_at, current_tier, loyalty_points, referral_code, email, username, sui_address, todays_earning, daily_reward_claim } = userData.data;

      this.log(
        `Username: ${username} | Earning today: ${todays_earning} | Total points: ${loyalty_points} | Email verify: ${
          email_verified_at ? new Date(email_verified_at).toLocaleDateString() : "Not verify"
        }`,
        "custom"
      );

      if (!api_secret) {
        if (!email_verified_at) {
          this.log(`Email not verify...Skip account ${this.itemData.email}`, "warning");
          return null;
        }
        this.log(`No secret found...generating new secret key...`, "warning");
        const result = await this.genarateKeySecret();
        if (result?.success) {
          this.log(`Generate new secret success!`, "success");
          api_secret = result.data.api_secret;
        } else {
          this.log(`Can't generate new secret | ${JSON.stringify(result)}`, "warning");
        }
      }
      this.itemData["api_secret"] = api_secret;
    } else {
      return this.log("Can't sync new data...skipping", "warning");
    }
    return userData;
  }

  async handleHB() {
    const result = await this.hb();
    if (result?.success) {
      this.log(`[${new Date().toLocaleString()}] Ping success!`, "success");
    } else {
      this.log(`[${new Date().toLocaleString()}] Ping failed! | ${JSON.stringify(result || {})}`, "warning");
    }
  }

  async runAccount() {
    this.session_name = this.itemData.email;
    this.authInfo = JSON.parse(this.localStorage[this.session_name] || "{}");
    this.token = this.authInfo?.access_token;
    this.#set_headers();
    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      this.log(`Bắt đầu sau ${timesleep} giây...`);
      await sleep(timesleep);
    }

    const token = await this.getValidToken();
    if (!token) return;
    this.token = token;
    const userData = await this.handleSyncData();
    await sleep(1);
    if (userData?.success) {
      if (!userData.data.next_daily_reward_claim || (userData.data.next_daily_reward_claim && (await this.checkInvaliable(userData.data.next_daily_reward_claim)))) {
        await this.handleCheckin();
        await sleep(1);
      } else {
        this.log(`Your checked in today! | Latest checkin: ${new Date(userData.data.next_daily_reward_claim).toLocaleString()}`, "warning");
      }
      const interValCheckPoint = setInterval(() => this.handleSyncData(), 3 * 60 * 60 * 1000);
      intervalIds.push(interValCheckPoint);
      // if (settings.AUTO_TASK) {
      //   await this.handleTasks();
      // }
      if (settings.AUTO_MINING) {
        await this.applySecret();
        await this.handleHB();
        const interValHB = setInterval(() => this.handleHB(), settings.DELAY_PING * 1000);
        intervalIds.push(interValHB);
      }
    } else {
      this.log("Can't get user info...skipping", "error");
    }
  }
}

function stopInterVal() {
  if (intervalIds.length > 0) {
    for (const intervalId of intervalIds) {
      clearInterval(intervalId);
    }
    intervalIds = [];
  }
}

async function main() {
  console.log(colors.yellow("TOOL SHARE BY (https://t.me/Bilalstudio2)"));

  const data = loadData("data.txt");
  const proxies = loadData("proxy.txt");
  let localStorage = JSON.parse(fs.readFileSync("localStorage.json", "utf8"));

  if (data.length == 0 || (data.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${data.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }

  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const { endpoint, message } = await checkBaseUrl();
  if (!endpoint) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);

  const itemDatas = data
    .map((val, index) => {
      const [email, password] = val.split("|");
      const item = {
        email: email,
        password: password,
        index,
      };
      return item;
    })
    .filter((i) => i !== null);

  process.on("SIGINT", async () => {
    console.log("Stopping...".yellow);
    stopInterVal();
    await sleep(1);
    process.exit();
  });

  await sleep(1);
  // while (true) {
  try {
    const newLocalData = await fsPromises.readFile("localStorage.json", "utf8");
    localStorage = JSON.parse(newLocalData);
  } catch (error) {
    console.log(`Can't load data localStorage.json | Clearing data...`.red);
    await fsPromises.writeFile("localStorage.json", JSON.stringify({}));
    localStorage = {}; // Khởi tạo localStorage như một đối tượng rỗng
  }
  await sleep(2);
  for (let i = 0; i < itemDatas.length; i += maxThreads) {
    const batch = itemDatas.slice(i, i + maxThreads);
    const promises = batch.map(async (itemData, indexInBatch) => {
      const accountIndex = i + indexInBatch;
      const proxy = proxies[accountIndex] || null;
      const client = new ClientAPI(itemData, accountIndex, proxy, endpoint, localStorage);
      return client.runAccount();
    });
    await Promise.all(promises);
  }
  // }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
