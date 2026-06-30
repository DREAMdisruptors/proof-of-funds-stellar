const modeBtns = document.querySelectorAll(".mode-btn");
const formAccount = document.getElementById("form-account");
const formManual = document.getElementById("form-manual");
const result = document.getElementById("result");
const resultMessage = document.getElementById("result-message");
const shareBlock = document.getElementById("share-block");
const shareUrlInput = document.getElementById("share-url");
const explorerLink = document.getElementById("explorer-link");

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    formAccount.hidden = mode !== "account";
    formManual.hidden = mode !== "manual";
    clearResult();
  });
});

function clearResult() {
  result.className = "";
  result.style.display = "none";
  resultMessage.textContent = "";
  shareBlock.style.display = "none";
  explorerLink.hidden = true;
}

async function submitProof(submitBtn, endpoint, body) {
  submitBtn.disabled = true;
  clearResult();
  result.className = "pending";
  result.style.display = "block";
  resultMessage.textContent = "Generating proof and verifying on Stellar testnet… (a few seconds)";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.ok) {
      result.className = "fail";
      resultMessage.textContent = `Error: ${data.error}`;
    } else if (data.verified) {
      result.className = "pass";
      resultMessage.textContent = `✓ ${data.message}`;

      if (data.shareUrl) {
        const fullUrl = location.origin + data.shareUrl;
        shareUrlInput.value = fullUrl;
        shareBlock.style.display = "";
      }

      if (data.explorerUrl) {
        explorerLink.href = data.explorerUrl;
        explorerLink.hidden = false;
      }
    } else {
      result.className = "fail";
      resultMessage.textContent = `✗ ${data.message || "Balance does not meet the threshold."}`;
    }
  } catch (err) {
    result.className = "fail";
    resultMessage.textContent = `Request failed: ${err}`;
  } finally {
    submitBtn.disabled = false;
  }
}

formAccount.addEventListener("submit", (e) => {
  e.preventDefault();
  const accountId = document.getElementById("accountId").value.trim();
  const threshold = document.getElementById("thresholdAccount").value;
  const asset = document.getElementById("asset").value;
  submitProof(e.target.querySelector(".submit"), "/api/prove-from-account", {
    accountId,
    threshold,
    asset,
  });
});

formManual.addEventListener("submit", (e) => {
  e.preventDefault();
  const balance = document.getElementById("balance").value;
  const threshold = document.getElementById("threshold").value;
  submitProof(e.target.querySelector(".submit"), "/api/prove", { balance, threshold });
});

function copyShareUrl() {
  const url = shareUrlInput.value;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById("copy-btn");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
}
