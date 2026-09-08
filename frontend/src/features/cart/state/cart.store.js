import { create } from "zustand";
import { cartAPI } from "../api/cart.api";

const normalizeCart = (cartData) =>
  cartData && Array.isArray(cartData.items) ? cartData : { items: [] };

const getDistinctItemCount = (cartData) =>
  Array.isArray(cartData?.items) ? cartData.items.length : 0;

export const useCartStore = create((set, get) => ({
  cart: { items: [] },
  cartCount: 0,
  isLoading: false,
  error: null,
  selectedForCheckout: [],
  lastAddedItem: null,

  getCart: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await cartAPI.getCart();
      const cartData = normalizeCart(response.data?.data);
      set({
        cart: cartData,
        cartCount: getDistinctItemCount(cartData),
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error.response?.data?.message || "Lấy giỏ hàng thất bại",
        isLoading: false,
      });
    }
  },

  fetchCartCount: async (token) => {
    try {
      const config = token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined;
      const response = await cartAPI.getCartCount(config);
      const count = Number(response?.data?.data?.count) || 0;
      set({ cartCount: count });
      return { success: true, count };
    } catch (error) {
      set({ cartCount: 0 });
      return {
        success: false,
        message: error.response?.data?.message || "Lấy số lượng giỏ hàng thất bại",
      };
    }
  },

  addToCart: async (variantId, quantity = 1, productType) => {
    if (!variantId) {
      const message = "Thiếu variantId";
      set({ error: message, isLoading: false });
      return { success: false, message };
    }

    if (!productType) {
      const message = "Thiếu productType";
      set({ error: message, isLoading: false });
      return { success: false, message };
    }

    set({ isLoading: true, error: null });

    try {
      const response = await cartAPI.addToCart({
        variantId,
        quantity,
        productType,
      });

      const cartData = normalizeCart(response.data?.data);

      set({
        cart: cartData,
        cartCount: getDistinctItemCount(cartData),
        isLoading: false,
        lastAddedItem: {
          variantId,
          timestamp: Date.now(),
        },
      });

      return { success: true, message: response.data?.message };
    } catch (error) {
      const message =
        error.response?.data?.message || "Thêm vào giỏ hàng thất bại";
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  updateCartItem: async (itemId, quantity) => {
    if (!itemId || quantity < 0) {
      return { success: false, message: "Thông tin không hợp lệ" };
    }

    set({ isLoading: true, error: null });
    try {
      const { cart } = get();

      const item = cart.items.find((i) => {
        const itemIdStr = i._id?.toString();
        const variantIdStr = i.variantId?.toString();
        const searchIdStr = itemId.toString();

        return itemIdStr === searchIdStr || variantIdStr === searchIdStr;
      });

      if (!item) {
        throw new Error("Không tìm thấy sản phẩm trong giỏ hàng");
      }

      const response = await cartAPI.updateItem({
        variantId: item.variantId,
        productType: item.productType,
        quantity,
      });

      const cartData = normalizeCart(response.data?.data);
      set({
        cart: cartData,
        cartCount: getDistinctItemCount(cartData),
        isLoading: false,
      });
      return { success: true };
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.message ||
        "Cập nhật giỏ hàng thất bại";
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  removeFromCart: async (itemId) => {
    if (!itemId) {
      return { success: false, message: "Thiếu thông tin sản phẩm" };
    }

    set({ isLoading: true, error: null });
    try {
      const { cart } = get();

      const item = cart.items.find((i) => {
        const itemIdStr = i._id?.toString();
        const variantIdStr = i.variantId?.toString();
        const searchIdStr = itemId.toString();

        return itemIdStr === searchIdStr || variantIdStr === searchIdStr;
      });

      if (!item) {
        throw new Error("Không tìm thấy sản phẩm trong giỏ hàng");
      }

      const deleteId = item._id || item.variantId;
      const response = await cartAPI.removeItem(deleteId);

      const cartData = normalizeCart(response.data?.data);
      set({
        cart: cartData,
        cartCount: getDistinctItemCount(cartData),
        isLoading: false,
      });
      return { success: true };
    } catch (error) {
      const message =
        error.response?.data?.message || error.message || "Xóa sản phẩm thất bại";
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  clearCart: async () => {
    set({ isLoading: true, error: null });
    try {
      await cartAPI.clearCart();
      set({ cart: { items: [] }, cartCount: 0, isLoading: false });
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || "Xóa giỏ hàng thất bại";
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  getTotal: () => {
    const { cart } = get();
    if (!cart || !Array.isArray(cart.items)) return 0;
    return cart.items.reduce(
      (total, item) => total + (item.price || 0) * (item.quantity || 0),
      0,
    );
  },

  getItemCount: () => {
    const { cart } = get();
    if (!cart || !Array.isArray(cart.items)) return 0;
    return cart.items.reduce((count, item) => count + (item.quantity || 0), 0);
  },

  getItemByVariant: (variantId) => {
    const { cart } = get();
    if (!cart || !Array.isArray(cart.items)) return null;

    return cart.items.find((item) => {
      const itemVariantId = item.variantId?.toString();
      const searchId = variantId?.toString();
      return itemVariantId === searchId;
    });
  },

  setSelectedForCheckout: (variantIds = []) => {
    const ids = Array.isArray(variantIds) ? variantIds : [];
    set({ selectedForCheckout: ids });
  },

  getSelectedTotal: () => {
    const { cart, selectedForCheckout } = get();
    if (!cart?.items || selectedForCheckout.length === 0) return 0;

    return cart.items
      .filter((item) => selectedForCheckout.includes(item.variantId))
      .reduce((sum, item) => sum + item.price * item.quantity, 0);
  },

  getSelectedItems: () => {
    const { cart, selectedForCheckout } = get();
    if (!cart?.items || selectedForCheckout.length === 0) return [];

    return cart.items.filter((item) =>
      selectedForCheckout.includes(item.variantId),
    );
  },

  clearError: () => set({ error: null }),

  resetCartState: () =>
    set({
      cart: { items: [] },
      cartCount: 0,
      selectedForCheckout: [],
      lastAddedItem: null,
      isLoading: false,
      error: null,
    }),

  shouldAutoSelect: () => {
    const { lastAddedItem } = get();
    if (!lastAddedItem) return null;

    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    const now = Date.now();

    if (now - lastAddedItem.timestamp <= EIGHT_HOURS) {
      return lastAddedItem.variantId;
    }

    return null;
  },
}));
