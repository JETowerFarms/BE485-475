import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../styles/theme';

const CONFIG_STORAGE_KEY = '@farm_form_configs';

// Save / Load configuration modal; all AsyncStorage ops self-contained.
const ConfigModal = ({ visible, onClose, buildSnapshot, onLoad }) => {
  const [configName, setConfigName] = useState('');
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');

  const loadSavedConfigs = useCallback(async () => {
    setConfigLoading(true);
    setConfigError('');
    try {
      const raw = await AsyncStorage.getItem(CONFIG_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSavedConfigs(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      setConfigError(err?.message || 'Failed to load saved configurations');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadSavedConfigs();
      setConfigError('');
    }
  }, [visible, loadSavedConfigs]);

  const saveCurrentConfig = async () => {
    const name = configName.trim();
    if (!name) {
      setConfigError('Name is required to save configuration');
      return;
    }
    const entry = {
      id: Date.now(),
      name,
      savedAt: new Date().toISOString(),
      snapshot: typeof buildSnapshot === 'function' ? buildSnapshot() : {},
    };

    try {
      const existing = savedConfigs.filter((c) => c.name !== name);
      const next = [entry, ...existing];
      await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
      setSavedConfigs(next);
      setConfigName('');
      setConfigError('');
    } catch (err) {
      setConfigError(err?.message || 'Failed to save configuration');
    }
  };

  const loadConfig = async (config) => {
    if (!config?.snapshot) return;
    if (typeof onLoad === 'function') onLoad(config.snapshot);
    onClose();
  };

  const deleteConfig = async (configId) => {
    try {
      const next = savedConfigs.filter((c) => c.id !== configId);
      await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
      setSavedConfigs(next);
    } catch (err) {
      setConfigError(err?.message || 'Failed to delete configuration');
    }
  };

  const confirmDeleteConfig = (config) => {
    Alert.alert(
      'Delete saved configuration',
      `Delete "${config?.name || 'Untitled'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteConfig(config.id),
        },
      ],
    );
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Save / Load configuration</Text>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.label}>Save current configuration</Text>
            <TextInput
              style={styles.input}
              value={configName}
              onChangeText={setConfigName}
              placeholder="Enter a name (required)"
              placeholderTextColor={COLORS.placeholder}
            />
            {configError ? <Text style={styles.errorText}>{configError}</Text> : null}
            <Pressable style={styles.saveBtn} onPress={saveCurrentConfig}>
              <Text style={styles.saveBtnText}>Save configuration</Text>
            </Pressable>

            <Text style={[styles.label, { marginTop: 16 }]}>Saved configurations</Text>
            {configLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.accent} />
                <Text style={styles.emptyText}>Loading configurations…</Text>
              </View>
            ) : savedConfigs.length === 0 ? (
              <Text style={styles.emptyText}>No saved configurations yet</Text>
            ) : (
              <View style={styles.list}>
                {savedConfigs.map((config) => (
                  <View key={config.id} style={styles.listItem}>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{config.name}</Text>
                      <Text style={styles.listMeta}>
                        {config.savedAt
                          ? new Date(config.savedAt).toLocaleString()
                          : ''}
                      </Text>
                    </View>
                    <View style={styles.listActions}>
                      <Pressable
                        style={styles.actionBtn}
                        onPress={() => loadConfig(config)}
                      >
                        <Text style={styles.actionBtnText}>Load</Text>
                      </Pressable>
                      <Pressable
                        style={styles.actionBtn}
                        onPress={() => confirmDeleteConfig(config)}
                      >
                        <Text style={[styles.actionBtnText, styles.danger]}>
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    width: '100%',
    maxHeight: '90%',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#C54B4B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
  },
  errorText: { color: '#C54B4B', fontSize: 14, marginTop: 6, marginBottom: 4 },
  saveBtn: {
    marginTop: 12,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  saveBtnText: { color: COLORS.buttonText, fontSize: 14, fontWeight: '700' },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  emptyText: {
    paddingVertical: 10,
    fontSize: 13,
    color: COLORS.textLight,
  },
  list: { marginTop: 8, gap: 8 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.inputBg,
  },
  listInfo: { flex: 1, paddingRight: 8 },
  listName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  listMeta: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  listActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  actionBtnText: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },
  danger: { color: '#C54B4B' },
});

export default ConfigModal;
