require("dotenv").config();

const express = require("express");
const cors = require("cors");

const PORT = process.env.PORT;
const MONGO_URL = process.env.MONGO_URL;
const MongoClient = require("mongodb").MongoClient;
const ObjectId = require("mongodb").ObjectId;
const client = new MongoClient(MONGO_URL);

const swaggerUi = require("swagger-ui-express");
const swaggerDoc = require("./swagger.json");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));
app.use("/swagger", swaggerUi.serve, swaggerUi.setup(swaggerDoc));

//Creazione unica connessione al db
let db;
async function connect() {
  if (!db) {
    await client.connect();
    db = client.db("ForkIt");
  }
  return db;
}

//GET per i dati dell'utente a partire da ID
app.get("/users/:id", async (req, res) => {
  //#swagger.description = 'Permette di recuperare i dati di un utente a partire dal suo id'
  try {
    const db = await connect();
    const user = await db
      .collection("users")
      .findOne({ _id: ObjectId.createFromHexString(req.params.id) });

    if (user) res.json(user);
    else res.status(404).json({ message: "Utente non trovato" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET per le categoria di piatti disponibili
app.get("/categories", async (_req, res) => {
  //#swagger.description = 'Recupera i nomi di tutte le categorie presenti nel database che hanno cibi validi'
  try {
    const db = await connect();
    const cats = await db
      .collection("foods")
      .aggregate([
        { $match: { deleted: { $ne: true } } }, // esclude piatti eliminati
        { $group: { _id: "$strCategory", count: { $sum: 1 } } }, //Come id tengo il nome della categoria
        { $match: { count: { $gt: 0 } } }, // tiene solo categorie con almeno 1 piatto
        { $sort: { _id: 1 } },
      ])
      .toArray();

    res.json(cats.map((c) => c._id)); //Restituisco solo il nome, senza il conteggio
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET per elenco completo ristoranti
app.get("/restaurants", async (_req, res) => {
  //#swagger.description = 'Recupera informazioni su tutti i ristoranti registrati nel database'
  try {
    const db = await connect();

    const list = await db
      .collection("restaurants")
      .find()
      .sort({ name: 1 })
      .toArray();

    res.json(list);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET singolo ristorante a partire da ID
app.get("/restaurants/:id", async (req, res) => {
  //#swagger.description = 'Restituisce le informazioni sul singolo ristorante con id passato'
  try {
    const db = await connect();

    const rst = await db
      .collection("restaurants")
      .findOne({ _id: ObjectId.createFromHexString(req.params.id) });

    if (rst) res.json(rst);
    else res.status(404).json({ error: "Ristorante non trovato" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET menu del singolo ristorante con filtri
app.get("/restaurants/:id/menu", async (req, res) => {
  //#swagger.description = 'Dato un id di un ristorante permette di ottenere il suo menu rispettando i filtri inseriti'
  try {
    const db = await connect();

    const rst = await db
      .collection("restaurants")
      .findOne({ _id: ObjectId.createFromHexString(req.params.id) });

    if (!rst) return res.status(404).json({ error: "Ristorante non trovato" });

    const nameRegex = req.query.name
      ? new RegExp(req.query.name.trim(), "i") //la i ignora maiusole e minuscole
      : null;

    let priceFilter = null;
    if (req.query.minPrice || req.query.maxPrice) {
      priceFilter = {};
      if (req.query.minPrice) priceFilter.$gte = +req.query.minPrice * 100;
      if (req.query.maxPrice) priceFilter.$lte = +req.query.maxPrice * 100;
    }
    if (!rst.menu) return res.status(200).json([]); //Se non ha menu torno vuoto

    const mongoCriteria = {
      _id: {
        $in: rst.menu.map((id) => ObjectId.createFromHexString(id)),
      },
    };

    if (req.query.category && req.query.category !== "special") {
      mongoCriteria.strCategory = req.query.category;
    }

    if (nameRegex) {
      mongoCriteria.strMeal = nameRegex;
    }

    if (priceFilter) {
      mongoCriteria.price = priceFilter;
    }

    const match = (meal) => {
      if (meal.deleted) return false;
      if (nameRegex && !nameRegex.test(meal.strMeal)) return false;
      if (priceFilter) {
        if (priceFilter.$gte && meal.price < priceFilter.$gte) return false;
        if (priceFilter.$lte && meal.price > priceFilter.$lte) return false;
      }
      if (req.query.category && req.query.category !== "special") {
        return meal.strCategory === req.query.category;
      }
      return true;
    };

    const menuIds = new Set(rst.menu.map((id) => id.toString()));

    if (req.query.category === "special") {
      const specials = rst.newFoods
        .filter((food) => menuIds.has(food._id.toString()) && match(food))
        .sort((a, b) => a.strMeal.localeCompare(b.strMeal));
      return res.json(specials);
    }

    const dbFoods = await db
      .collection("foods")
      .find({ ...mongoCriteria, deleted: { $ne: true } })
      .sort({ strMeal: 1 })
      .toArray();

    //Se non è impostata categoria torna tutto
    if (!req.query.category) {
      const specials = rst.newFoods.filter(
        (food) => menuIds.has(food._id.toString()) && match(food)
      );
      const all = [...dbFoods, ...specials].sort((a, b) =>
        a.strMeal.localeCompare(b.strMeal)
      );
      return res.json(all);
    }

    return res.json(dbFoods);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET per tutti i piatti (esclusi speciali) con filtri
app.get("/meals", async (req, res) => {
  //#swagger.description = 'Permette di recuperare tutti i cibi standard rispettando eventuali filtri'
  try {
    const filter = {};

    if (req.query.category) filter.strCategory = req.query.category;
    if (req.query.name?.trim())
      filter.strMeal = { $regex: req.query.name.trim(), $options: "i" };
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice)
        filter.price.$gte = Number(req.query.minPrice) * 100;
      if (req.query.maxPrice)
        filter.price.$lte = Number(req.query.maxPrice) * 100;
    }
    filter.deleted = { $ne: true };

    const db = await connect();

    const meals = await db
      .collection("foods")
      .find(filter)
      .sort({ strMeal: 1 })
      .toArray();

    res.json(meals);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET per qualunque piatto da id, anche se deleted
app.get("/meals/:mealId", async (req, res) => {
  //#swagger.description = 'Permette di recuperare informazioni sul cibo con id passato. Recupera anche cibi segnati come deleted'
  const mealId = ObjectId.createFromHexString(req.params.mealId);

  try {
    const db = await connect();

    const meal = await db.collection("foods").findOne({
      _id: mealId,
    });
    if (meal) return res.json(meal);

    const special = await db
      .collection("restaurants")
      .aggregate([
        { $unwind: "$newFoods" },
        { $match: { "newFoods._id": mealId } },
        { $replaceRoot: { newRoot: "$newFoods" } },
      ])
      .next();

    if (special) return res.json(special);

    return res.status(404).json({ message: "Meal non trovato" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: e.message });
  }
});

//POST per inserire un nuovo cibo con distinzione per specilità o cibi standard
app.post("/meals", async (req, res) => {
  //#swagger.description = 'Permette di inserire un nuovo piatto. Un amministratore può inserirlo di qualunque tipo
  // mentre un ristoratore solo nella categoria special'
  const {
    strMeal,
    strCategory,
    strInstructions,
    strMealThumb,
    strYoutube,
    ingredients,
    measures,
    price,
    strTags,
    prepTime,
    restaurant,
  } = req.body;

  try {
    const db = await connect();

    //Se da inserire in cibi standard
    if (strCategory !== "special") {
      const result = await db.collection("foods").insertOne({
        strMeal,
        strCategory,
        price: Number(price),
        strTags,
        strInstructions,
        strMealThumb,
        strYoutube,
        ingredients,
        measures,
        prepTime: Number(prepTime),
      });
      return res.status(201).json({
        _id: result.insertedId,
        message: "Cibo inserito correttamente",
      });
    }

    //Per ristoratore inserire specialità
    if (!restaurant)
      return res
        .status(400)
        .json({ message: 'Per la categoria "special" serve restaurantId' });

    const newFood = {
      _id: new ObjectId(),
      strMeal,
      strCategory: "special",
      price: Number(price),
      strTags,
      strInstructions,
      strMealThumb,
      strYoutube,
      ingredients,
      measures,
      prepTime: Number(prepTime),
    };

    const upd = await db
      .collection("restaurants")
      .updateOne(
        { _id: ObjectId.createFromHexString(restaurant) },
        { $push: { newFoods: newFood } }
      );

    if (!upd.modifiedCount)
      return res.status(404).json({ message: "Ristorante non trovato" });

    res
      .status(201)
      .json({ _id: newFood._id, message: "Specialità inserita correttamente" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

//PUT per aggiornare cibi sia standard sia specialità (standard uso solo i campi che mi servono nel progetto)
app.put("/meals/:mealId", async (req, res) => {
  //#swagger.description = 'Permette di fare modifiche sul cibo con id indicato. Usata da ristoratore per modifiche
  // a specialità sua o da admin per modifiche sui cibi standard'
  const mealId = ObjectId.createFromHexString(req.params.mealId);
  const newData = { ...req.body }; //se facessi req.body ho riferimento a stesso oggetto
  newData.price = Number(newData.price);
  newData.prepTime = Number(newData.prepTime);

  try {
    const db = await connect();

    const updFoods = await db
      .collection("foods")
      .updateOne({ _id: mealId }, { $set: newData });
    if (updFoods.modifiedCount)
      return res.json({ message: "Meal aggiornato in cibi standard" });

    const setObj = {};
    for (const [key, val] of Object.entries(newData)) {
      setObj[`newFoods.$[elem].${key}`] = val;
    }
    const updRest = await db
      .collection("restaurants")
      .updateOne(
        { "newFoods._id": mealId },
        { $set: setObj },
        { arrayFilters: [{ "elem._id": mealId }] }
      );

    if (updRest.modifiedCount)
      return res.json({ message: "Specialità aggiornata correttamente" });

    res.status(404).json({ message: "Meal non trovato" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

//DELETE per eliminare logicamente un piatto
app.delete("/meals/:mealId", async (req, res) => {
  //#swagger.description = 'Permette di eliminare un cibo. Se admin cibi standard, se ristoratore cibi speciali. L'eliminazione consiste
  // nell inserire attributo deleted:true per non avere inconsistenze eliminando direttamente'
  const mealId = ObjectId.createFromHexString(req.params.mealId);

  try {
    const db = await connect();

    //Eliminazione da piatti standard
    const delFoods = await db
      .collection("foods")
      .updateOne({ _id: mealId }, { $set: { deleted: true } });
    if (delFoods.modifiedCount)
      return res.json({ message: "Cibo eliminato correttamente " });

    //Eliminazione specialità
    const delRest = await db
      .collection("restaurants")
      .updateOne(
        { "newFoods._id": mealId },
        { $set: { "newFoods.$[elem].deleted": true } },
        { arrayFilters: [{ "elem._id": mealId }] }
      );
    if (delRest.modifiedCount)
      return res.json({ message: "Specialità eliminata correttamente" });

    res.status(404).json({ message: "Meal non trovato" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

//POST per verifica credianziali login
app.post("/users/login", async (req, res) => {
  //#swagger.description = 'Verifica se le credenziali passate sono valide'
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email o password mancanti" });
  }

  try {
    const db = await connect();
    const user = await db.collection("users").findOne({ email, password });

    if (user) res.json(user);
    else res.status(401).json({ message: "Credenziali errate" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//POST per registrazione sia client sia ristoratore 
app.post("/users", async (req, res) => {
  //#swagger.description = 'Permette di inserire un nuovo utente, sia cliente sia ristoratore, nel database'
  const cNome = req.body.name;
  const cCognome = req.body.surname;
  const cEmail = req.body.email;
  const cPassword = req.body.password;
  const cRole = req.body.role;
  const cResturantId = req.body.restaurantId;
  const cfoods = cRole === "restorator" ? req.body.foods : []; 

  //Controlli vari
  if (!cNome || cNome.length < 3) {
    return res
      .status(400)
      .json({ success: false, message: "Nome troppo corto" });
  }
  if (!cCognome || cCognome.length < 3) {
    return res
      .status(400)
      .json({ success: false, message: "Cognome troppo corto" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cEmail)) {
    return res
      .status(400)
      .json({ success: false, message: "Email fornita non valida" });
  }

  if (cPassword.length < 5) {
    return res.status(400).json({
      success: false,
      message: "Password deve essere lunga almeno 5",
    });
  }
  let user;
  if (cRole !== "admin") {
    user = {
      name: cNome,
      surname: cCognome,
      email: cEmail,
      password: cPassword,
      role: cRole,
      restaurant: cResturantId,
      foods: cfoods,
    };
  } else {
    user = {
      name: cNome,
      surname: cCognome,
      email: cEmail,
      password: cPassword,
      role: cRole,
    };
  }

  try {
    const db = await connect();

    await db.collection("users").insertOne(user);
    res.json({ success: true, message: "Utente registrato correttamente" });
  } catch (e) {
    if (e.code === 11000)
      res.status(409).json({ success: false, message: "Email già in uso" });
    else res.status(500).json({ success: false, message: e.message });
  }
});

//GET per ottenere ID ristorante da codice segreto 
app.get("/restaurants/code/:code", async (req, res) => {
  //#swagger.description = 'Dato il codice segreto di un ristorante restituisce il ristorante'
  try {
    const db = await connect();

    const rst = await db
      .collection("restaurants")
      .findOne({ secretCode: req.params.code });

    if (!rst) return res.status(404).json({ message: "Codice non valido" });
    res.json(rst);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//POST per aggiungere un cibo ai preferiti utente 
app.post("/users/:id/favorites", async (req, res) => {
  //#swagger.description = 'Permette di aggiungere un cibo tra i preferiti dell utente. Se ristoratore corrisponde anche al menu del
  // ristorante in gestione'
  const userId = req.params.id;
  const mealId = req.body.mealId;
  try {
    const db = await connect();
    const usersCol = db.collection("users");
    const restCol = db.collection("restaurants");
    const user = await usersCol.findOne({
      _id: ObjectId.createFromHexString(userId),
    });
    if (!user) return res.status(404).json({ message: "Utente non trovato" });
    await usersCol.updateOne(
      { _id: user._id },
      { $addToSet: { foods: mealId } }
    );
    console.log(mealId);

    if (user.role === "restorator" && user.restaurant) {
      await restCol.updateOne(
        { _id: ObjectId.createFromHexString(user.restaurant) },
        { $addToSet: { menu: mealId } }
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//DELETE per rimuovere un cibo dai preferiti
app.delete("/users/:id/favorites", async (req, res) => {
  //#swagger.description = 'Permette di eliminare un cibo tra i preferiti dell utente. Se ristoratore corrisponde anche al menu del
  // ristorante in gestione'
  const userId = req.params.id;
  const mealId = req.body.mealId;

  try {
    const db = await connect();
    const usersCol = db.collection("users");
    const restCol = db.collection("restaurants");

    const user = await usersCol.findOne({
      _id: ObjectId.createFromHexString(userId),
    });
    if (!user) return res.status(404).json({ message: "Utente non trovato" });

    await usersCol.updateOne({ _id: user._id }, { $pull: { foods: mealId } });

    if (user.role === "restorator" && user.restaurant) {
      await restCol.updateOne(
        { _id: ObjectId.createFromHexString(user.restaurant) },
        { $pull: { menu: mealId } }
      );
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//GET newFoods del ristorante. Usato per poterli vedere da ristoratore anche se non in menu - Usato da menu 
app.get("/restaurants/:id/specials", async (req, res) => {
  //#swagger.description = 'Restituisce la lista delle specialità di uno specifico ristorante, anche se non in menu'
  try {
    const db = await connect();

    const rst = await db
      .collection("restaurants")
      .findOne({ _id: ObjectId.createFromHexString(req.params.id) });

    if (!rst)
      return res.status(404).json({ message: "Ristorante non trovato" });

    //Inizio costruzione filtri
    const nameRegex = req.query.name
      ? new RegExp(req.query.name.trim(), "i") //la i ignora maiusole e minuscole
      : null;

    let priceFilter = {};
    if (req.query.minPrice || req.query.maxPrice) {
      if (req.query.minPrice) priceFilter.$gte = +req.query.minPrice * 100; //Il + è come fare un Number()
      if (req.query.maxPrice) priceFilter.$lte = +req.query.maxPrice * 100;
    }

    const match = (meal) => {
      if (meal.deleted) return false;
      if (nameRegex && !nameRegex.test(meal.strMeal)) return false;
      if (priceFilter) {
        if (priceFilter.$gte && meal.price < priceFilter.$gte) return false;
        if (priceFilter.$lte && meal.price > priceFilter.$lte) return false;
      }
      if (req.query.category && req.query.category !== "special") {
        return meal.strCategory === req.query.category;
      }
      return true;
    };

    const specials = rst.newFoods
      .filter(match)
      .sort((a, b) => a.strMeal.localeCompare(b.strMeal));
    return res.json(specials);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//DELETE per elimianare utente 
app.delete("/users/:id", async (req, res) => {
  //#swagger.description = 'Rimuove completamente il documento utente con id indicato'
  const userId = req.params.id;

  try {
    const db = await connect();
    const result = await db
      .collection("users")
      .deleteOne({ _id: ObjectId.createFromHexString(userId) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Utente non trovato" });
    }

    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Errore interno del server" });
  }
});

//PUT per modificare dati utente 
app.put("/users/:id", async (req, res) => {
  //#swagger.description = 'Permette di modificare i dati utente'
  const userId = ObjectId.createFromHexString(req.params.id);
  const { name, surname, email, password, restaurant, paymentMethod } =
    req.body || {};

  try {
    const db = await connect();
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ message: "Utente non trovato" });

    //Vari controlli sui dati
    if (!name || name.trim().length < 3)
      return res
        .status(400)
        .json({ error: "Nome deve avere almeno 3 caratteri" });

    if (!surname || surname.trim().length < 3)
      return res
        .status(400)
        .json({ error: "Cognome deve avere almeno 3 caratteri" });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email))
      return res.status(400).json({ message: "Email non valida" });

    if (!password)
      return res
        .status(400)
        .json({ message: "Password obbligatoria per conferma" });

    if (password !== user.password)
      return res.status(401).json({ message: "Password errata" });

    if (user.role === "client") {
      if (paymentMethod === undefined) {
        if (
          !paymentMethod.cardNumber ||
          !paymentMethod.expiry ||
          !paymentMethod.owner ||
          !paymentMethod.cvv
        )
          return res.status(400).json({ message: "Dati carta incompleti" });
        if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(paymentMethod.expiry))
          return res
            .status(400)
            .json({ message: "Formato scadenza carta non valido: MM/YY" });
      }
    }

    const emailUsed = await db
      .collection("users")
      .findOne({ email, _id: { $ne: userId } });
    if (emailUsed)
      return res
        .status(409)
        .json({ message: "Email già in uso da un altro account" });

    const updateDoc = {
      $set: {
        name: name.trim(),
        surname: surname.trim(),
        email: email.trim(),
      },
    };

    if (user.role === "client") {
      updateDoc.$set.restaurant = restaurant;
      updateDoc.$set.paymentMethod = {
        cardNumber: paymentMethod.cardNumber,
        expiry: paymentMethod.expiry,
        owner: paymentMethod.owner,
        cvv: paymentMethod.cvv,
      };
    }

    await db.collection("users").updateOne({ _id: userId }, updateDoc);

    return res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Errore interno del server" });
  }
});

// PATCH per modifica password 
app.patch("/users/:id/password", async (req, res) => {
  //#swagger.description = 'Permette di modificare il solo campo password dell'utente'
  const userId = ObjectId.createFromHexString(req.params.id);

  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword)
    return res.status(400).json({ message: "Password mancanti" });

  if (newPassword.length < 5)
    return res.status(400).json({ message: "Password troppo corta" });

  try {
    const db = await connect();
    const user = await db.collection("users").findOne({ _id: userId });

    if (!user) return res.status(404).json({ message: "Utente non trovato" });

    if (oldPassword !== user.password)
      return res.status(401).json({ message: "Password attuale errata" });

    await db
      .collection("users")
      .updateOne({ _id: userId }, { $set: { password: newPassword } });

    return res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Errore interno del server" });
  }
});

//PUT per modifica dati ristorante 
app.put("/restaurants/:id", async (req, res) => {
  //#swagger.description = 'Permette di modificare i dati del ristorante'
  const ristId = ObjectId.createFromHexString(req.params.id);

  const { name, contacts = {}, openingHours, PIVA } = req.body || {};

  try {
    const db = await connect();
    const coll = db.collection("restaurants");

    const rist = await coll.findOne({ _id: ristId });
    if (!rist)
      return res.status(404).json({ message: "Ristorante non trovato" });

    //Controlli per dati validi
    if (!name || name.trim().length < 3)
      return res
        .status(400)
        .json({ message: "Nome deve avere almeno 3 caratteri" });

    //2 cifre per le ore : 2 cifre per minuti
    const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    const isSlot = (s) => s && hhmm.test(s.open) && hhmm.test(s.close);
    if (
      openingHours &&
      (!Array.isArray(openingHours.lunVen) ||
        openingHours.lunVen.some((s) => !isSlot(s)) ||
        !isSlot(openingHours.sabDom)) //Se ho gli openings ma LunVen non ha pausa pomeridiana e c'è qualcosa che non rispetta regex manda errore
    ) {
      return res
        .status(400)
        .json({ message: "Formato orari non valido (HH:MM)" });
    }

    const updateDoc = {
      $set: {
        name: name.trim(),
      },
    };

    if (contacts.tel2) updateDoc.$set["contacts.tel2"] = contacts.tel2.trim();

    if (openingHours) updateDoc.$set.openingHours = openingHours;

    if (PIVA) updateDoc.$set.PIVA = PIVA.trim();

    await coll.updateOne({ _id: ristId }, updateDoc);

    return res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore interno del server" });
  }
});

//GET per gli ordini di un utente
app.get("/users/:id/orders", async (req, res) => {
  //#swagger.description = 'Dato id utente restituisce gli ordini a lui associati'
  const userId = ObjectId.createFromHexString(req.params.id);
  const db = await connect();
  const user = await db.collection("users").findOne({ _id: userId });
  if (!user) return res.status(404).json({ message: "Utente non trovato" });
  const userOrderIds = Array.isArray(user.orders) ? user.orders : [];

  if (userOrderIds.length === 0) return res.status(200).json([]);

  const orders = await db
    .collection("orders")
    .find({
      _id: {
        $in: user.orders.map((id) => ObjectId.createFromHexString(id)) || [],
      },
    })
    .toArray();
  res.json(orders);
});

//GET per gli ordini di un ristorante 
app.get("/restaurants/:id/orders", async (req, res) => {
  //#swagger.description = 'Dato id ristorante restituisce gli ordini a lui associati'

  const restId = new ObjectId(req.params.id);
  const db = await connect();

  const rest = await db.collection("restaurants").findOne({ _id: restId });
  if (!rest) return res.status(404).json({ message: "Ristorante non trovato" });
  if (!rest.orders || rest.orders.length === 0) {
    return res.json([]);
  }
  const orders = await db
    .collection("orders")
    .find({
      _id: {
        $in: rest.orders.map((id) => ObjectId.createFromHexString(id)) || [],
      },
    })
    .toArray();

  res.json(orders);
});

//GET per gli ordini totali
app.get("/orders", async (req, res) => {
  //#swagger.description = 'Restituisce tutti gli ordini salvati nel database'
  try {
    const db = await connect();

    const list = await db.collection("orders").find().toArray();

    res.json(list);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

//POST per creazione ordine 
app.post("/orders", async (req, res) => {
  //#swagger.description = 'Permette di inserire un nuovo ordine'
  const { place, foods } = req.body || {};

  //FOndamentali per l'ordine sono ristorante ed i cibi
  if (!place || !Array.isArray(foods))
    return res.status(400).json({ message: "Dati mancanti" });

  try {
    const db = await connect();

    //Dai cibi nell'ordine prendo i vari id e creo oggetto -> Controllo in foods
    const mealIds = foods.map((f) => ObjectId.createFromHexString(f.mealId));
    const mealsFoods = await db
      .collection("foods")
      .find({ _id: { $in: mealIds } })
      .project({ price: 1, prepTime: 1 }) //Mi interessa solo prezzo e tempo di preparazione
      .toArray();

    //Divido gli id trovati in foods e quelli da cercare nelle specialità
    const foundIds = new Set(mealsFoods.map((m) => m._id.toString()));
    const missingIds = mealIds.filter((id) => !foundIds.has(id.toString()));

    //Se ci sono id non trovati (potenzialmente specialità che quindi non sono in foods) cerca in tutti i ristoranti
    let mealsNewFoods = [];
    if (missingIds.length) {
      mealsNewFoods = await db
        .collection("restaurants")
        .aggregate([
          //Considero tutti i documenti senza fare match o filtri e quindi il resto lo applica su ognuno
          { $unwind: "$newFoods" }, //srotola array newFoods per trattarli come documenti unici
          { $match: { "newFoods._id": { $in: missingIds } } }, //prende quelli che matchano
          { $replaceRoot: { newRoot: "$newFoods" } }, //tengo solo questo sotto documento newFood
          { $project: { price: 1, prepTime: 1 } }, //prendo solo campo price e prepTime
        ])
        .toArray();
    }

    //creo la mappa unendo i due risultati e mappo id/prezzo
    const priceMap = Object.fromEntries(
      [...mealsFoods, ...mealsNewFoods].map((m) => [m._id.toString(), m.price])
    );
    const timeMap = Object.fromEntries(
      [...mealsFoods, ...mealsNewFoods].map((m) => [
        m._id.toString(),
        m.prepTime,
      ])
    );
    //Per totale ordine sia per prezzo sia preparazione
    let totalPrice = 0;
    let waitingTime = 0;
    for (const item of foods) {
      const price = priceMap[item.mealId];
      const time = timeMap[item.mealId];
      if (price === undefined || time === undefined)
        return res
          .status(400)
          .json({ message: "Meal non trovato: " + item.mealId });
      totalPrice += price * item.quantity;
      waitingTime += time * item.quantity;
    }
    const doc = {
      place: place,
      foods,
      totalPrice,
      date: new Date(),
      state: "ordinato",
      waitingTime: waitingTime,
    };

    const { insertedId } = await db.collection("orders").insertOne(doc);
    res.status(201).json({ _id: insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore interno" });
  }
});

//PATCH per legare ordine a user
app.patch("/users/:id/orders", async (req, res) => {
  //#swagger.description = 'Aggiorna documento utente indicato legandolo ad un nuovo ordine'
  const userId = ObjectId.createFromHexString(req.params.id);
  const orderId = req.body.orderId;

  if (!orderId) {
    return res.status(400).json({ message: "orderId mancante" });
  }

  try {
    const db = await connect();

    const result = await db
      .collection("users")
      .updateOne({ _id: userId }, { $addToSet: { orders: orderId } });

    if (!result.matchedCount)
      return res.status(404).json({ message: "Utente non trovato" });

    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore interno" });
  }
});

//PATCH per legare ordine a ristorante 
app.patch("/restaurants/:id/orders", async (req, res) => {
  //#swagger.description = 'Aggiorna documento ristorante indicato legandolo ad un nuovo ordine'
  const restId = ObjectId.createFromHexString(req.params.id);
  const orderId = req.body.orderId;

  if (!orderId) {
    return res.status(400).json({ message: "orderId mancante" });
  }

  try {
    const db = await connect();

    const result = await db
      .collection("restaurants")
      .updateOne({ _id: restId }, { $addToSet: { orders: orderId } });

    if (!result.matchedCount)
      return res.status(404).json({ message: "Ristorante non trovato" });

    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Errore interno" });
  }
});

//PATCH per modifica stato ordine
app.patch(`/orders/:orderId/:currentState`, async (req, res) => {
  //#swagger.description = 'Permette di modificare lo stato di un ordine facendolo avanzare al prossimo'
  const orderId = ObjectId.createFromHexString(req.params.orderId);

  try {
    const db = await connect();
    const order = await db.collection("orders").findOne({ _id: orderId });
    if (!order) return res.status(404).json({ message: "Ordine non trovato" });
    let nextState;
    switch (req.params.currentState) {
      case "ordinato":
        nextState = "in preparazione";
        break;
      case "in preparazione":
        nextState = "in consegna";
        break;
      case "in consegna":
        nextState = "consegnato";
        break;
      default:
        break;
    }

    await db
      .collection("orders")
      .updateOne({ _id: orderId }, { $set: { state: nextState } });

    return res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Errore interno del server" });
  }
});

//POST usato da admin per creare nuovo ristorante 
app.post("/restaurants", async (req, res) => {
  //#swagger.description = 'Permette di creare un nuovo ristorante'
  const { name, address, contacts, secretCode, PIVA, openingHours } = req.body;

  //Controlli sui dati
  if (!name || name.trim().length < 3)
    return res
      .status(400)
      .json({ message: "Nome deve avere almeno 3 caratteri" });

  const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const isSlot = (s) => s && hhmm.test(s.open) && hhmm.test(s.close);
  if (
    openingHours &&
    (!Array.isArray(openingHours.lunVen) ||
      openingHours.lunVen.some((s) => !isSlot(s)) ||
      !isSlot(openingHours.sabDom)) //Se ho gli openings ma LunVen non ha pausa pomeridiana e c'èqualcosa che non rispetta regex manda errore
  ) {
    return res
      .status(400)
      .json({ message: "Formato orari non valido (HH:MM)" });
  }

  const newRestaurant = {
    name,
    address,
    contacts,
    secretCode,
    PIVA,
    openingHours,
    menu: [],
  };
  try {
    const db = await connect();
    const result = await db.collection("restaurants").insertOne(newRestaurant);
    return res.status(201).json({
      _id: result.insertedId,
      message: "Ristorante insetito correttamente",
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.listen(PORT, () =>
  console.log(`Backend pronto su http://localhost:${PORT}`)
);
