import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "./lib/supabase";

type Product = {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string;
  category: string;
};

type CartItem = {
  product_id: number;
  quantity: number;
  product: Product;
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  useEffect(() => {
    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    setSession(session);
    setCheckingSession(false);

    if (session) {
      await loadProducts();
      await loadCart(session.user.id);
    }
  }

  async function handleAuth() {
    if (!email.trim() || !password) {
      Alert.alert(
        "Missing information",
        "Enter your email and password."
      );
      return;
    }

    setAuthLoading(true);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      console.log("SIGN UP RESULT:", {
        user: data.user,
        session: data.session,
        error: error?.message,
      });

      if (error) {
        Alert.alert("Sign up failed", error.message);
      } else if (data.session) {
        setSession(data.session);
        await loadProducts();
        await loadCart(data.session.user.id);
      } else {
        Alert.alert(
          "No session",
          "The account was created, but Supabase did not return a login session."
        );
      }
    } else {
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (error) {
        Alert.alert("Login failed", error.message);
      } else {
        setSession(data.session);
        await loadProducts();

        if (data.session) {
          await loadCart(data.session.user.id);
        }
      }
    }

    setAuthLoading(false);
  }

  async function loadProducts() {
    setProductsLoading(true);

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("id");

    if (error) {
      Alert.alert("Product error", error.message);
      setProductsLoading(false);
      return;
    }

    setProducts(data || []);
    setProductsLoading(false);
  }

  async function loadCart(userId: string) {
    const { data: cartRows, error } = await supabase
      .from("cart_items")
      .select("product_id, quantity")
      .eq("user_id", userId);

    if (error) {
      console.log("Cart load error:", error.message);
      return;
    }

    if (!cartRows || cartRows.length === 0) {
      setCart([]);
      return;
    }

    const productIds = cartRows.map((row) => row.product_id);

    const { data: productRows, error: productError } =
      await supabase
        .from("products")
        .select("*")
        .in("id", productIds);

    if (productError) {
      console.log("Cart product error:", productError.message);
      return;
    }

    const productMap = new Map(
      (productRows || []).map((product) => [product.id, product])
    );

    const combinedCart: CartItem[] = cartRows
      .map((row) => {
        const product = productMap.get(row.product_id);

        if (!product) {
          return null;
        }

        return {
          product_id: row.product_id,
          quantity: row.quantity,
          product,
        };
      })
      .filter(Boolean) as CartItem[];

    setCart(combinedCart);
  }

  // Add an item to the shared Supabase cart
  async function addToCart(product: Product) {
    if (!session) {
      Alert.alert("Please sign in first.");
      return;
    }

    const { error } = await supabase
      .from("cart_items")
      .upsert(
        {
          user_id: session.user.id,
          product_id: product.id,
          quantity: 1,
        },
        {
          onConflict: "user_id,product_id",
        }
      );

    if (error) {
      Alert.alert("Cart error", error.message);
      return;
    }

    await loadCart(session.user.id);

    Alert.alert(
      "Added to cart",
      `${product.name} is now in your shared cart.`
    );
  }

  async function removeFromCart(productId: number) {
    if (!session) {
      return;
    }

    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("user_id", session.user.id)
      .eq("product_id", productId);

    if (error) {
      Alert.alert("Cart error", error.message);
      return;
    }

    await loadCart(session.user.id);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setCart([]);
    setShowCart(false);
  }

  function formatPrice(price: number) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(price);
  }

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    loadCart(session.user.id);

    const channel = supabase
      .channel(`cart-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cart_items",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          loadCart(session.user.id);
        }
      )
      .subscribe((status, error) => {
        if (error) {
          console.log("Realtime error:", error);
        }

        console.log("Realtime status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const cartCount = cart.reduce(
    (total, item) => total + item.quantity,
    0
  );

  if (checkingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!session) {
    return (
      <KeyboardAvoidingView
        style={styles.loginContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={styles.logo}>LuxeMart</Text>

        <Text style={styles.loginTitle}>
          {isSignUp ? "Create your account" : "Welcome back"}
        </Text>

        <Text style={styles.loginSubtitle}>
          {isSignUp
            ? "Join LuxeMart and shop with ease."
            : "Sign in to continue shopping."}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email address"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={styles.button}
          onPress={handleAuth}
          disabled={authLoading}
        >
          {authLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {isSignUp ? "Create Account" : "Sign In"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsSignUp(!isSignUp)}
        >
          <Text style={styles.switchText}>
            {isSignUp
              ? "Already have an account? Sign in"
              : "New to LuxeMart? Create an account"}
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    );
  }

  if (showCart) {
    return (
      <View style={styles.container}>
        <View style={styles.cartHeader}>
          <TouchableOpacity
            onPress={() => setShowCart(false)}
          >
            <Text style={styles.backText}>← Shop</Text>
          </TouchableOpacity>

          <Text style={styles.cartTitle}>
            Your Cart ({cartCount})
          </Text>
        </View>

        {cart.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>
              Your cart is empty
            </Text>

            <Text style={styles.emptyText}>
              Add something from the website and it will appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={cart}
            keyExtractor={(item) =>
              item.product_id.toString()
            }
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.cartCard}>
                <Image
                  source={{ uri: item.product.image_url }}
                  style={styles.cartImage}
                />

                <View style={styles.cartInfo}>
                  <Text style={styles.name}>
                    {item.product.name}
                  </Text>

                  <Text style={styles.price}>
                    {formatPrice(item.product.price)}
                  </Text>

                  <Text style={styles.quantity}>
                    Quantity: {item.quantity}
                  </Text>

                  <TouchableOpacity
                    onPress={() =>
                      removeFromCart(item.product_id)
                    }
                  >
                    <Text style={styles.removeText}>
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>LuxeMart</Text>

          <Text style={styles.loggedIn}>
            Signed in
          </Text>
        </View>

        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.cartButton}
            onPress={() => setShowCart(true)}
          >
            <Text style={styles.cartButtonText}>
              Cart ({cartCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {productsLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Image
                source={{ uri: item.image_url }}
                style={styles.image}
              />

              <View style={styles.info}>
                <Text style={styles.category}>
                  {item.category}
                </Text>

                <Text style={styles.name}>
                  {item.name}
                </Text>

                <Text style={styles.description}>
                  {item.description}
                </Text>

                <Text style={styles.price}>
                  {formatPrice(item.price)}
                </Text>

                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => addToCart(item)}
                >
                  <Text style={styles.addButtonText}>
                    Add to Cart
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },

  logo: {
    fontSize: 32,
    fontWeight: "bold",
  },

  loginTitle: {
    fontSize: 23,
    fontWeight: "600",
    marginTop: 10,
  },

  loginSubtitle: {
    color: "#666",
    marginTop: 6,
    marginBottom: 24,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },

  button: {
    backgroundColor: "#000",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },

  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },

  switchText: {
    textAlign: "center",
    marginTop: 18,
    color: "#555",
  },

  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },

  header: {
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 15,
    backgroundColor: "#fff",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  loggedIn: {
    color: "#666",
    marginTop: 3,
  },

  signOut: {
    fontWeight: "bold",
  },

  cartButton: {
    backgroundColor: "#000",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },

  cartButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },

  list: {
    padding: 16,
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
  },

  image: {
    width: "100%",
    height: 220,
  },

  info: {
    padding: 15,
  },

  category: {
    color: "#666",
    fontSize: 13,
  },

  name: {
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 4,
  },

  description: {
    color: "#666",
    marginTop: 6,
    lineHeight: 21,
  },

  price: {
    fontSize: 19,
    fontWeight: "bold",
    marginTop: 10,
  },

  addButton: {
    backgroundColor: "#000",
    padding: 13,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 14,
  },

  addButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  emptyTitle: {
    fontSize: 22,
    fontWeight: "bold",
  },

  emptyText: {
    textAlign: "center",
    color: "#666",
    marginTop: 8,
  },

  cartHeader: {
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },

  backText: {
    fontWeight: "600",
  },

  cartTitle: {
    fontSize: 22,
    fontWeight: "bold",
  },

  cartCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    marginBottom: 14,
    overflow: "hidden",
    flexDirection: "row",
  },

  cartImage: {
    width: 120,
    height: 120,
  },

  cartInfo: {
    flex: 1,
    padding: 12,
  },

  quantity: {
    color: "#666",
    marginTop: 6,
  },

  removeText: {
    color: "#b00020",
    fontWeight: "600",
    marginTop: 10,
  },
});