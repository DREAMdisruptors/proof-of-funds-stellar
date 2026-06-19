const tabs = document.querySelectorAll(".tab");
const formManual = document.getElementById("form-manual");
const formAccount = document.getElementById("form-account");
const result = document.getElementById("result");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    formManual.hidden = mode !== "manual";
    formAccount.hidden = mode !== "account";
    result.className = "";
    result.textContent = "";
  });
});

async function submitProof(submitBtn, endpoint, body) {
  submitBtn.disabled = true;
  result.className = "pending";
  result.textContent = "Generating proof and verifying on Stellar testnet… (a few seconds)";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      result.className = "fail";
      result.textContent = `Error: ${data.error}`;
    } else if (data.verified) {
      result.className = "pass";
      result.textContent =
        `✅ ${data.message}\n\nContract: ${data.contractId}\n${data.explorerUrl}`;
    } else {
      result.className = "fail";
      result.textContent = `❌ ${data.message}`;
    }
  } catch (err) {
    result.className = "fail";
    result.textContent = `Request failed: ${err}`;
  } finally {
    submitBtn.disabled = false;
  }
}

formManual.addEventListener("submit", (e) => {
  e.preventDefault();
  const balance = document.getElementById("balance").value;
  const threshold = document.getElementById("threshold").value;
  submitProof(e.target.querySelector(".submit"), "/api/prove", { balance, threshold });
});

formAccount.addEventListener("submit", (e) => {
  e.preventDefault();
  const accountId = document.getElementById("accountId").value.trim();
  const threshold = document.getElementById("thresholdAccount").value;
  submitProof(e.target.querySelector(".submit"), "/api/prove-from-account", { accountId, threshold });
});
