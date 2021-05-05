// initialize Stripe API
const config = {
  donationServerUrl: "",
  stripeKey: ""
}

const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
const stripe = Stripe(config.stripeKey, {locale: 'de'});
const stripeElements = stripe.elements();

function gotoPaymentForm(name) {
  if (!isAmountValid()) {
    $("#custom-amount").focus();
    return;
  }

  $(".payment-amount").text(`${getAmount()}€, ${getInterval() === 0 ? "einmalig" : "monatlich"}`);
  swipe(name);
}

function checkInitialAmount() {
  const url = new URL(location.href);
  const amount = parseInt(url.searchParams.get("amount"));
  if (isNaN(amount)) return;

  const amountElem = document.querySelector('input[name="amount"][value="' + amount + '"]');
  if (amountElem != null) { // Set pre existing amount
    amountElem.checked = true;
  } else if (amount >= 1 && amount < 10000) { // Set custom amount
    $("#custom-amount").val(String(amount))
      .parent().removeClass("hidden");
    $('input[name="amount"][value="custom"]').prop("checked", true);
  }
}

function isAmountValid() {
  const amount = getAmount();
  return !isNaN(amount) && amount >= 1;
}

function init() {
  // Handle custom amounts
  $("[name='amount']").on('change', () => {
    const isCustom = $("[name='amount']:checked").val() === "custom";
    $(".custom-amount-group").toggleClass("hidden", !isCustom)
    if (isCustom) {
      $("#custom-amount").focus();
    }
  });

  $("#custom-amount").on('keydown', ev => {
    if (ev.ctrlKey || ev.altKey) return;
    if (!ev.key.match(/^[0-9]$/i) && ev.key !== "Backspace") {
      ev.preventDefault();
    }
  })

  $("#button-paypal-1,#button-paypal-2").on('click', function () {
    if (isAmountValid()) {
      $(this).parent().submit();
    } else {
      $("#custom-amount").focus();
    }
  })

  // Initialize payment forms
  initSepaForm(document.querySelector(".sepa-form"))
  initCardForm(document.querySelector(".card-form"))
}

function initSepaForm(sepaForm) {
  const sepaIban = sepaForm.querySelector("#sepa-iban-elem");
  const sepaIbanElement = stripeElements.create("iban", {
    style: {
      base: {
        backgroundColor: "#fff",
        fontSize: "20px"
      }
    },
    supportedCountries: ["SEPA"],
    placeholderCountry: "AT",
  });
  sepaIbanElement.mount(sepaIban);

  let sepaIbanError = "Dieses Feld darf nicht leer sein";
  sepaIbanElement.on("change", (ev) => {
    if (ev.empty) {
      sepaIbanError = "Dieses Feld darf nicht leer sein"
    } else if (!ev.complete || ev.error != null) {
      sepaIbanError = "Bitte gib eine gültige IBAN ein"
    } else {
      sepaIbanError = null;
    }
  });

  const errorElem = sepaForm.querySelector(".form-error");
  const submitButton = sepaForm.querySelector(".sepa-submit");
  submitButton.addEventListener("click", ev => {
    ev.preventDefault();
    errorElem.innerHTML = "";

    const validationResults = [
      validateField("sepa-name"),
      validateField("sepa-email", value => {
        if (!emailRegex.test(value.toLowerCase())) return "Bitte gib eine gültige E-Mail ein";
      }),
      showFieldError(sepaIban, sepaIbanError)
    ];

    if (validationResults.some(valid => !valid)) return;
    setButtonLoading(submitButton, true)

    const email = sepaForm.querySelector("#sepa-email").value;
    const amount = getAmount();
    const interval = getInterval();

    stripe.createSource(sepaIbanElement, {
      type: 'sepa_debit',
      currency: 'eur',
      owner: {name: sepaForm.querySelector("#sepa-name").value}
    }).then(result => {
      if (result.error)
        throw new Error(result.error);

      return postJson("/donate/sepa", {
        email,
        amount,
        type: interval === 0 ? "one-time" : "monthly",
        sourceId: result.source.id
      });
    }).then(r => r.json()).then(data => {
      if (data.error)
        throw new Error(data.error);

      if (data.mandateUrl != null) {
        document.querySelector("#swipe-thanks .extra-info").innerHTML = 'Im Zuge dieser Zahlung wurde ein ' +
          'SEPA Mandat ausgestellt. Dieses kannst du <a href="' + data.mandateUrl + '" target="_blank">hier</a> einsehen.';
      }
      swipe("swipe-thanks");
    }).catch(err => {
      errorElem.innerHTML = err.message;
      console.error(err);
    }).then(() => { // then after catch is finally
      setButtonLoading(submitButton, false)
    })
  })
}

function initCardForm(cardForm) {
  const cardInfo = cardForm.querySelector("#card-elem");
  const cardInfoElement = stripeElements.create("card", {
    style: {
      base: {
        backgroundColor: "#fff",
        fontSize: "20px"
      }
    }
  });
  cardInfoElement.mount(cardInfo);

  let cardInfoError = "Dieses Feld darf nicht leer sein";
  cardInfoElement.on("change", (ev) => {
    if (ev.empty) {
      cardInfoError = "Dieses Feld darf nicht leer sein"
    } else if (!ev.complete || ev.error != null) {
      cardInfoError = "Bitte gib gültige Kreditkarteninformationen ein";
    } else {
      cardInfoError = null;
    }
  });

  const errorElem = cardForm.querySelector(".form-error");
  const submitButton = cardForm.querySelector(".card-submit");
  submitButton.addEventListener("click", ev => {
    ev.preventDefault();
    errorElem.innerHTML = "";

    const validationResults = [
      validateField("card-name"),
      validateField("card-email", value => {
        if (!emailRegex.test(value.toLowerCase())) return "Bitte gib eine gültige E-Mail ein";
      }),
      showFieldError(cardInfo, cardInfoError)
    ];

    if (validationResults.some(valid => !valid)) return;
    setButtonLoading(submitButton, true)

    const email = cardForm.querySelector("#card-email").value;
    const amount = getAmount();
    const interval = getInterval();

    stripe.createSource(cardInfoElement, {
      type: 'card',
      currency: 'eur',
      owner: {name: cardForm.querySelector("#card-name").value}
    }).then(result => {
      if (result.error)
        throw new Error(result.error);

      return postJson("/donate/card", {
        email,
        amount,
        type: interval === 0 ? "one-time" : "monthly",
        sourceId: result.source.id
      })
    }).then(response => response.json()).then(jsonData => {
      if (jsonData.error)
        throw new Error(jsonData.error);

      swipe("swipe-thanks");
    }).catch(err => {
      errorElem.innerHTML = err.message;
      console.error(err);
    }).then(() => { // then after catch is finally
      setButtonLoading(submitButton, false)
    })
  });
}

/* Helpers */
function postJson(endpoint, data) {
  return fetch(config.donationServerUrl + endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(data)
  })
}

function validateField(id, validator) {
  const fieldElem = document.getElementById(id);
  if (fieldElem === null)
    throw new Error(`Field ${id} not found`);

  let error;
  const value = fieldElem.value;
  if (value == null || value.trim().length < 1) {
    error = "Dieses Feld darf nicht leer sein";
  } else if (validator != null) {
    error = validator(value, fieldElem);
  }

  return showFieldError(fieldElem, error);
}

function showFieldError(childElem, error) {
  const fieldError = childElem.parentElement.querySelector(".field-error");
  if (error != null) {
    fieldError.innerHTML = error;
    return false;
  } else {
    fieldError.innerHTML = "";
    return true;
  }
}

function getAmount() {
  const selectedAmount = document.querySelector('input[name="amount"]:checked').value;
  if (selectedAmount !== "custom") return parseInt(selectedAmount);
  return parseInt($("#custom-amount").val());
}

const getInterval = () => parseInt(document.querySelector('input[name="interval"]:checked').value);

function setButtonLoading(button, loading) {
  button.disabled = loading;
  if (loading) {
    button.innerHTML += `<div class="button-loading-bar"></div>`;
  } else {
    button.querySelectorAll(".button-loading-bar").forEach(elem => elem.remove());
  }
}