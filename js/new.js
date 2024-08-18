const donationServerUrl = ""; // TODO Configure

const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
let stripe;
let stripeElements;

fetch(donationServerUrl + "/config")
  .then(resp => resp.json())
  .then(json => {
    stripe = Stripe(json["publicKey"], {locale: 'de'});
    stripeElements = stripe.elements();
    console.log("config", json)

    init();
  })
  .catch(err => {
    alert("Der Spendenserver konnte nicht erreicht werden. Bitte probiere es später erneut!")
    console.log(err);
  })

function gotoPaymentForm(name) {
  if (!isAmountValid()) {
    $("#custom-amount").focus();
    return;
  }

  const amount = getAmount();
  const interval = getInterval();

  if (interval === 0) {
    $(".address-group").toggleClass("hidden", amount < 500)
  } else if (interval === 1) {
    $(".address-group").toggleClass("hidden", amount < 40)
  }

  $(".payment-amount").text(amount);
  $(".payment-interval").text(`${interval === 0 ? "einmalig" : "monatlich"}`);
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
  if (isNaN(amount) || amount < 1) {
    return false;
  }

  if (getInterval() === 0) {
    return amount < 1000;
  } else {
    return amount < 500;
  }
}

function init() {
  checkInitialAmount();

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
      validateField("sepa-street", value => {
        if (value.trim().length < 5) return "Bitte gib eine gültige Adresse ein";
      }, hasAddressForm()),
      validateField("sepa-postcode", value => {
        const valueInt = parseInt(value)
        if (isNaN(valueInt) || valueInt < 1000 || valueInt >= 10000) return "Bitte gib eine gültige Postleitzahl ein";
      }, hasAddressForm()),
      validateField("sepa-city", value => {
        if (value.trim().length < 2) return "Bitte gib eine gültige Stadt ein";
      }, hasAddressForm()),
      showFieldError(sepaIban, sepaIbanError)
    ];

    if (validationResults.some(valid => !valid)) return;
    setButtonLoading(submitButton, true)

    const name = sepaForm.querySelector("#sepa-name").value;
    const email = sepaForm.querySelector("#sepa-email").value;
    const street = hasAddressForm() ? $("#sepa-street").val() : undefined;
    const postcode = hasAddressForm() ? $("#sepa-postcode").val() : undefined;
    const city = hasAddressForm() ? $("#sepa-city").val() : undefined;
    const amount = getAmount();
    const interval = getInterval();

    postJson(interval === 0 ? "/payment-intent" : "/subscription", { name, email, amount })
      .then(resp => resp.json())
      .then(jsonData => {
        if (jsonData.error != null) {
          throw getError(jsonData.error)
        }

        return stripe.confirmSepaDebitPayment(jsonData["secret"], {
          payment_method: {
            sepa_debit: sepaIbanElement,
            billing_details: {
              name,
              email,
              address: getAddress(street, postcode, city)
            }
          }
        })
      })
      .then(result => {
        if (result.error != null)
          throw getError(result.error);

        return postJson("/payment-intent/finish", {
          intentId: result.paymentIntent.id
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.error != null)
          throw getError(data.error);

        if (data.mandateUrl != null) {
          document.querySelector("#swipe-thanks .extra-info").innerHTML = 'Im Zuge dieser Zahlung wurde ein ' +
            'SEPA Mandat ausgestellt. Dieses kannst du <a href="' + data.mandateUrl + '" target="_blank">hier</a> einsehen.';
        }
        swipe("swipe-thanks");
      })
      .catch(err => {
        errorElem.innerHTML = err.message;
        console.error(err);
      })
      .then(() => { // then after catch is finally
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
      validateField("card-street", value => {
        if (value.trim().length < 5) return "Bitte gib eine gültige Adresse ein";
      }, hasAddressForm()),
      validateField("card-postcode", value => {
        const valueInt = parseInt(value)
        if (isNaN(valueInt) || valueInt < 1000 || valueInt >= 10000) return "Bitte gib eine gültige Postleitzahl ein";
      }, hasAddressForm()),
      validateField("card-city", value => {
        if (value.trim().length < 2) return "Bitte gib eine gültige Stadt ein";
      }, hasAddressForm()),
      showFieldError(cardInfo, cardInfoError)
    ];

    if (validationResults.some(valid => !valid)) return;
    setButtonLoading(submitButton, true)

    const name = cardForm.querySelector("#card-name").value;
    const email = cardForm.querySelector("#card-email").value;
    const street = hasAddressForm() ? $("#card-street").val() : undefined;
    const postcode = hasAddressForm() ? $("#card-postcode").val() : undefined;
    const city = hasAddressForm() ? $("#card-city").val() : undefined;
    const amount = getAmount();
    const interval = getInterval();

    postJson(interval === 0 ? "/payment-intent" : "/subscription", { name, email, amount })
      .then(resp => resp.json())
      .then(jsonData => {
        if (jsonData["error"] != null) {
          throw getError(jsonData["error"])
        }

        return stripe.confirmCardPayment(jsonData["secret"], {
          payment_method: {
            card: cardInfoElement,
            billing_details: {
              name,
              email,
              address: getAddress(street, postcode, city)
            }
          },
          return_url: donationServerUrl,
        })
      })
      .then(result => {
        if (result.error != null)
          throw getError(result.error);
        else if (result.last_payment_error != null)
          throw getError(result.last_payment_error);

        return postJson("/payment-intent/finish", {
          intentId: result.paymentIntent.id
        })
      })
      .then(response => response.json())
      .then(jsonData => {
        if (jsonData.error)
          throw getError(jsonData.error);

        swipe("swipe-thanks");
      })
      .catch(err => {
        errorElem.innerHTML = err.message;
        console.error(err);
      })
      .then(() => {
        setButtonLoading(submitButton, false)
      })
  });
}

/* Helpers */
function getAddress(street, postcode, city) {
  if (street == null || postcode == null || city == null) {
    return undefined;
  }
  return {
    city,
    line1: street,
    postal_code: postcode,
    country: "AT"
  }
}

function getError(error) {
  if (typeof error === "string") {
    return new Error(error);
  } else if (error && error["message"]) {
    return new Error(error["message"]);
  } else {
    return new Error(JSON.stringify(error))
  }
}

function hasAddressForm() {
  return !$(".address-group").hasClass("hidden")
}

function postJson(endpoint, data) {
  return fetch(donationServerUrl + endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(data)
  })
}

function validateField(id, validator = null, required = true) {
  const fieldElem = document.getElementById(id);
  if (fieldElem === null)
    throw new Error(`Field ${id} not found`);

  let error;

  const value = fieldElem.value ?? "";
  const isEmpty = value.trim().length < 1;

  if (isEmpty && required) {
    error = "Dieses Feld darf nicht leer sein";
  } else if (!isEmpty && validator != null) {
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

function getInterval() {
  return parseInt(document.querySelector('input[name="interval"]:checked').value);
}

function setButtonLoading(button, loading) {
  button.disabled = loading;
  if (loading) {
    button.innerHTML += `<div class="button-loading-bar"></div>`;
  } else {
    button.querySelectorAll(".button-loading-bar").forEach(elem => elem.remove());
  }
}