//Carica in pagina navbar - OKKKKKKKKKKKKKKKK
function loadNavbar() {
  return fetch("/components/navbar.html")
    .then((res) => res.text())
    .then((html) => {
      document.getElementById("navbar-placeholder").innerHTML = html;
    });
}

//Carica in pagina footer - OKKKKKKKKKKKKKKKKKK
function loadFooter() {
  return fetch("/components/footer.html")
    .then((res) => res.text())
    .then((html) => {
      document.getElementById("footer-placeholder").innerHTML = html;
    });
}

//Funzione per creare i vari link della navbar - OKKKKKKKKKKKKKKK
function createNavItem(text, href, icon = null) {
  const li = document.createElement("li");
  li.className = "nav-item";

  const a = document.createElement("a");
  a.className = "nav-link";
  a.href = href;
  a.innerHTML = icon ? `<i class="${icon} fs-5"></i>` : text;

  li.appendChild(a);
  return li;
}

//Usa crea link per aggiungere alla navbar in base a utente loggato - OKKKKKKKKKKKKKKKK
function setupNavbar() {
  const nav = document.getElementById("navbar-links");
  nav.innerHTML = "";

  const userId = localStorage.getItem("user_id");
  const role = localStorage.getItem("role");

  nav.appendChild(createNavItem("Menu", "menu.html"));
  nav.appendChild(createNavItem("Restaurants", "restaurants.html"));

  if (!userId) {
    nav.appendChild(createNavItem("Login", "login.html"));
    nav.appendChild(createNavItem("Sign In", "signIn.html"));
    return;
  }

  nav.appendChild(createNavItem("Profile", "profile.html"));

  switch (role) {
    case "client":
      nav.appendChild(createNavItem("Orders", "orders.html"));
      nav.appendChild(createNavItem("", "cart.html", "bi bi-cart-fill"));
      break;
    case "restorator":
      nav.appendChild(createNavItem("Orders", "orders.html"));
      nav.appendChild(createNavItem("Stats", "statistics.html"));
      break;
    case "admin":
      nav.appendChild(createNavItem("Stats", "statistics.html"));
      break;
  }
}

//Funzione per Alert temporaneo - OKKKKKKKKKKKKKKK
function showTemporaryAlert(message, type, duration = 3000) {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type} position-fixed top-0 start-50 translate-middle-x mt-3 shadow z-3`;
  alert.innerHTML = message;
  document.body.appendChild(alert);
  setTimeout(() => {
    alert.classList.add("fade");
    setTimeout(() => alert.remove(), 150);
  }, duration);
}


//Mostra alert fisso - OKKKKKKKKKKKKKKKKKK
function showAlert(msg, type) {
  const alert = document.getElementById("alert");
  alert.className = `alert alert-${type}`;
  alert.innerHTML = msg;
  alert.classList.remove("d-none");
}

//Carica i dati dell'utente - OKKKKKKKKKKKKKKK
async function loadUserData() {
  const userId = localStorage.getItem("user_id");
  if (!userId) return;
  try {
    const res = await fetch(`http://localhost:3001/users/${userId}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Impossibile ottenere i dati utente:", e);
  }
}

//Carica i dati del ristorante - OKKKKKKKKKKKKKK
async function loadRestaurantData(ristId) {
  try {
    const res = await fetch(`http://localhost:3001/restaurants/${ristId}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Impossibile ottenere i dati ristorante:", e);
  }
}

//Carica i dati del cibo - OKKKKKKKKKKKKKKKK
async function loadMealData(mealId) {
  try {
    const res = await fetch(`http://localhost:3001/meals/${mealId}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Impossibile ottenere i dati cibo:", e);
  }
}

//Mostra il dettaglio dei cibi cliccando sulla card
function showMealDetail(meal) {
  const detail = document.getElementById("meal-detail");
  const content = document.getElementById("meal-detail-content");

  const ingredients = meal.ingredients || [];
  const measures = meal.measures || [];
  const combined = ingredients.map((ing, i) => `${ing} - ${measures[i]}`);

  content.innerHTML = `
        <div class="row">
                        <div class="col-6">
                          <img src="${
                            meal.strMealThumb
                          }" class="mb-3 w-100 rounded-2" />
                            <div class="mt-2">
                              <p><strong>Categoria:</strong> ${
                                meal.strCategory
                              }</p>
                              <p><strong>Tags:</strong> ${
                                meal.strTags || "Nessuno"
                              }</p>
                              <h5 class="text-teal mt-2">Ingredienti</h5>
                              <ul>
                                ${combined.map((i) => `<li>${i}</li>`).join("")}
                              </ul>
                              ${
                                meal.strYoutube
                                  ? `<p class="mt-3"><a class="text-teal" href="${meal.strYoutube}" target="_blank">Guarda su YouTube</a></p>
                                  `
                                  : ""
                              }
                            </div>
                          </div>
                          <div class="col-6">
                          <h2 class="text-teal">${meal.strMeal}</h2>
                          <p><strong>Preparazione:</strong><br>${
                            meal.strInstructions
                          }</p>
                                                    </div>

                          </div>`;
  detail.classList.remove("d-none");
}

//Formatta orari di apertura - OKKKKKKKKKKKKKKKKKKK
function formatHours(oh) {
  const toRange = (arr) =>
    arr.map(({ open, close }) => `${open}-${close}`).join(", ");
  return `Lun–Ven: ${toRange(oh.lunVen)} | Sab–Dom: ${oh.sabDom.open}-${
    oh.sabDom.close
  }`;
}
