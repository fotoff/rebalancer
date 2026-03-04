// Stub for @react-native-async-storage/async-storage (used by MetaMask SDK)
// Web apps use localStorage instead
const noop = () => Promise.resolve(null);
export default {
  getItem: noop,
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
  clear: () => Promise.resolve(),
  getAllKeys: () => Promise.resolve([]),
  multiGet: () => Promise.resolve([]),
  multiSet: () => Promise.resolve(),
  multiRemove: () => Promise.resolve(),
};
