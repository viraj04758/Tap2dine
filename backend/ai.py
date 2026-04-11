"""
Tap2Dine — AI Recommendations via Gemini Flash
Falls back to rule-based logic if no API key is configured.
"""
import os
import json
import random
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Complementary pairings (rule-based fallback)
PAIRINGS = {
    "starters": ["drinks", "mains"],
    "mains":    ["drinks", "desserts", "starters"],
    "pizza":    ["drinks", "desserts"],
    "burgers":  ["drinks", "desserts"],
    "desserts": ["drinks"],
    "drinks":   ["starters", "desserts"],
}

REASONS = {
    "drinks":   "Pairs perfectly with your meal 🥤",
    "desserts": "End on a sweet note 🍮",
    "starters": "A great way to kick things off 🥢",
    "mains":    "Complete your meal with this classic 🍲",
    "pizza":    "Crowd favourite — you'll love it 🍕",
    "burgers":  "Can't stop at just one 🍔",
}


def _rule_based_recommendations(cart_items: list, menu: list) -> list:
    """Return up to 3 suggestions using simple category-pairing rules."""
    cart_ids   = {item["id"] for item in cart_items}
    cart_cats  = {item.get("cat", "") for item in cart_items}
    target_cats = set()
    for cat in cart_cats:
        target_cats.update(PAIRINGS.get(cat, []))

    candidates = [
        m for m in menu
        if m["id"] not in cart_ids and m.get("cat") in target_cats
    ]
    random.shuffle(candidates)
    results = []
    seen_cats: set[str] = set()
    for item in candidates:
        cat = item.get("cat", "")
        if cat not in seen_cats:
            seen_cats.add(cat)
            results.append({
                "id":     item["id"],
                "name":   item["name"],
                "emoji":  item["emoji"],
                "price":  item["price"],
                "cat":    cat,
                "reason": REASONS.get(cat, "Customers love this combination ✨"),
            })
        if len(results) >= 3:
            break
    return results


async def get_recommendations(cart_items: list, menu: list) -> list:
    """
    Return 3 AI-powered recommendations.
    Uses Gemini Flash if GEMINI_API_KEY is set; otherwise rule-based fallback.
    """
    if not cart_items:
        return []

    if not GEMINI_API_KEY:
        return _rule_based_recommendations(cart_items, menu)

    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")

        cart_names = [f"{i['name']} (₹{i['price']})" for i in cart_items]
        menu_list  = [
            {"id": m["id"], "name": m["name"], "cat": m["cat"], "price": m["price"]}
            for m in menu
            if m["id"] not in {c["id"] for c in cart_items}
        ]

        prompt = f"""You are a restaurant recommendation engine.
A customer has these items in their cart: {", ".join(cart_names)}.

From the menu below, suggest exactly 3 complementary items that pair well.
Return ONLY valid JSON — a list of 3 objects with keys: id (int), name (str), reason (str, max 8 words).

Menu: {json.dumps(menu_list[:30])}"""

        response = model.generate_content(prompt)
        text = response.text.strip()

        # Strip markdown code fences if present
        if "```" in text:
            # Extract content between the first ``` and the last ```
            text = text.split("```")[1]  # e.g. 'json\n[...]'
            if text.startswith("json"):
                text = text[4:].strip()
            text = text.strip()

        suggestions = json.loads(text)
        # Enrich with full menu data
        menu_map = {m["id"]: m for m in menu}
        result = []
        for s in suggestions[:3]:
            item = menu_map.get(int(s["id"]))
            if item:
                result.append({
                    "id":     item["id"],
                    "name":   item["name"],
                    "emoji":  item["emoji"],
                    "price":  item["price"],
                    "cat":    item["cat"],
                    "reason": s.get("reason", "Great pairing ✨"),
                })
        return result if result else _rule_based_recommendations(cart_items, menu)

    except Exception as e:
        print(f"[AI] Gemini failed ({e}), using rule-based fallback")
        return _rule_based_recommendations(cart_items, menu)
