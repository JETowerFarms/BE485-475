import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../styles/theme';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

// Modal for selecting the optimization model.
const ModelPickerModal = ({ visible, onClose, selectedModelId, onSelect }) => {
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const resp = await apiFetch(buildApiUrl('/models'));
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Failed to load models (${resp.status})`);
      }
      const data = await resp.json();
      setModels(Array.isArray(data?.models) ? data.models : []);
    } catch (err) {
      setModelsError(err?.message || 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchModels();
  }, [visible, fetchModels]);

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
            <Text style={styles.title}>Choose model</Text>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Pressable style={styles.refreshBtn} onPress={fetchModels}>
              <Text style={styles.refreshBtnText}>Refresh models</Text>
            </Pressable>

            {modelsLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.accent} />
                <Text style={styles.emptyText}>Loading models…</Text>
              </View>
            ) : modelsError ? (
              <Text style={styles.errorText}>{modelsError}</Text>
            ) : models.length === 0 ? (
              <Text style={styles.emptyText}>No models found</Text>
            ) : (
              <View style={styles.list}>
                {models.map((model) => (
                  <View key={model.id} style={styles.listItem}>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{model.name}</Text>
                      {model.description ? (
                        <Text style={styles.listMeta}>{model.description}</Text>
                      ) : null}
                      {selectedModelId === model.id ? (
                        <Text style={styles.selectedTag}>Selected</Text>
                      ) : null}
                    </View>
                    <View style={styles.listActions}>
                      <Pressable
                        style={styles.useBtn}
                        onPress={() => {
                          onSelect(model);
                          onClose();
                        }}
                      >
                        <Text style={styles.useBtnText}>Use</Text>
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
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 16 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  emptyText: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: COLORS.textLight,
  },
  errorText: {
    color: '#C54B4B',
    fontSize: 14,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  refreshBtn: {
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  refreshBtnText: {
    color: COLORS.buttonText,
    fontSize: 14,
    fontWeight: '700',
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
  selectedTag: {
    marginTop: 6,
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  listActions: { flexDirection: 'row', gap: 8 },
  useBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  useBtnText: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },
});

export default ModelPickerModal;
