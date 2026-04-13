import React, { useState, useEffect } from 'react';
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
import { COLORS } from '../styles/theme';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

const emptyCropForm = {
  id: null,
  name: '',
  category: '',
  unit: '',
  yield_per_acre: '',
  price_per_unit_0: '',
  cost_per_acre: '',
  escalation_rate: '',
};

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  return Number.isFinite(num)
    ? num.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : String(value);
};

// Crop-table editor modal with full CRUD (create / edit / delete).
const CropEditorModal = ({ visible, onClose, cropOptions, onSaved, onDeleted }) => {
  const [mode, setMode] = useState('create');
  const [cropForm, setCropForm] = useState({ ...emptyCropForm });
  const [cropEditorError, setCropEditorError] = useState('');
  const [cropEditorSaving, setCropEditorSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      resetForm();
    }
  }, [visible]);

  const resetForm = () => {
    setCropForm({ ...emptyCropForm });
    setMode('create');
    setCropEditorError('');
  };

  const startEditCrop = (crop) => {
    if (!crop) return;
    setMode('edit');
    setCropForm({
      id: crop.id ?? null,
      name: crop.name || crop.crop || '',
      category: crop.category || '',
      unit: crop.unit || '',
      yield_per_acre:
        crop.yield_per_acre !== null && crop.yield_per_acre !== undefined
          ? String(crop.yield_per_acre)
          : '',
      price_per_unit_0:
        crop.price_per_unit_0 !== null && crop.price_per_unit_0 !== undefined
          ? String(crop.price_per_unit_0)
          : '',
      cost_per_acre:
        crop.cost_per_acre !== null && crop.cost_per_acre !== undefined
          ? String(crop.cost_per_acre)
          : '',
      escalation_rate:
        crop.escalation_rate !== null && crop.escalation_rate !== undefined
          ? String(crop.escalation_rate)
          : '',
    });
    setCropEditorError('');
  };

  const buildPayload = () => {
    const errs = [];
    const name = cropForm.name.trim();
    const unit = cropForm.unit.trim();
    if (!name) errs.push('Name is required');
    if (!unit) errs.push('Unit is required');

    const parseNum = (value, label, { allowEmpty = false } = {}) => {
      if (value === '' || value === null || value === undefined) {
        if (allowEmpty) return null;
        errs.push(`${label} is required`);
        return null;
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
        errs.push(`${label} must be a number`);
        return null;
      }
      return num;
    };

    const payload = {
      name,
      crop: name,
      category: cropForm.category.trim() || null,
      unit,
      yield_per_acre: parseNum(cropForm.yield_per_acre, 'yield_per_acre'),
      price_per_unit_0: parseNum(cropForm.price_per_unit_0, 'price_per_unit_0'),
      cost_per_acre: parseNum(cropForm.cost_per_acre, 'cost_per_acre'),
      escalation_rate:
        parseNum(cropForm.escalation_rate, 'escalation_rate', {
          allowEmpty: true,
        }) ?? 0,
    };

    return { errs, payload };
  };

  const saveCropFromForm = async () => {
    setCropEditorError('');
    const { errs, payload } = buildPayload();
    if (errs.length) {
      setCropEditorError(errs.join('; '));
      return;
    }

    const isEdit = mode === 'edit' && cropForm.id;
    setCropEditorSaving(true);
    try {
      const response = await apiFetch(
        buildApiUrl(isEdit ? `/crops/${cropForm.id}` : '/crops'),
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        const detail =
          data?.details?.join('; ') || data?.message || response.statusText;
        throw new Error(detail || 'Failed to save crop');
      }

      if (typeof onSaved === 'function') onSaved(data);
      resetForm();
    } catch (err) {
      setCropEditorError(err?.message || 'Failed to save crop');
    } finally {
      setCropEditorSaving(false);
    }
  };

  const deleteCropById = async (cropId) => {
    setCropEditorError('');
    setCropEditorSaving(true);
    try {
      const response = await apiFetch(buildApiUrl(`/crops/${cropId}`), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to delete crop');
      }

      if (typeof onDeleted === 'function') onDeleted(cropId);
      if (cropForm.id === cropId) resetForm();
    } catch (err) {
      setCropEditorError(err?.message || 'Failed to delete crop');
    } finally {
      setCropEditorSaving(false);
    }
  };

  const confirmDeleteCrop = (crop) => {
    if (!crop?.id) return;
    Alert.alert(
      'Delete crop',
      `Are you sure you want to delete "${crop.name || crop.crop}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteCropById(crop.id),
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
            <Text style={styles.title}>Crop table</Text>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.label}>
              {mode === 'edit' ? 'Edit crop' : 'Add a new crop'}
            </Text>

            {[
              { key: 'name', label: 'Name *', placeholder: 'e.g., Corn' },
              { key: 'category', label: 'Category', placeholder: 'e.g., Row crop' },
              { key: 'unit', label: 'Unit *', placeholder: 'e.g., bushel' },
              {
                key: 'yield_per_acre',
                label: 'Yield per acre *',
                placeholder: 'e.g., 180',
                numeric: true,
              },
              {
                key: 'price_per_unit_0',
                label: 'Price per unit (year 0) *',
                placeholder: 'e.g., 4.2',
                numeric: true,
              },
              {
                key: 'cost_per_acre',
                label: 'Cost per acre *',
                placeholder: 'e.g., 650',
                numeric: true,
              },
              {
                key: 'escalation_rate',
                label: 'Escalation rate',
                placeholder: 'e.g., 0.02',
                numeric: true,
              },
            ].map(({ key, label, placeholder, numeric }) => (
              <View key={key} style={styles.inputGroup}>
                <Text style={styles.subLabel}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={cropForm[key]}
                  onChangeText={(text) =>
                    setCropForm((prev) => ({ ...prev, [key]: text }))
                  }
                  placeholder={placeholder}
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType={numeric ? 'numeric' : 'default'}
                />
              </View>
            ))}

            {cropEditorError ? (
              <Text style={styles.errorText}>{cropEditorError}</Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.saveBtn, cropEditorSaving && styles.disabled]}
                onPress={saveCropFromForm}
                disabled={cropEditorSaving}
              >
                {cropEditorSaving ? (
                  <ActivityIndicator size="small" color={COLORS.buttonText} />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {mode === 'edit' ? 'Update crop' : 'Add crop'}
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, cropEditorSaving && styles.disabled]}
                onPress={resetForm}
                disabled={cropEditorSaving}
              >
                <Text style={styles.secondaryBtnText}>Start new</Text>
              </Pressable>
            </View>

            <Text style={[styles.label, { marginTop: 12 }]}>Existing crops</Text>
            {!cropOptions || cropOptions.length === 0 ? (
              <Text style={styles.emptyText}>No crops available yet</Text>
            ) : (
              <View style={styles.cropList}>
                {cropOptions.map((crop) => (
                  <View key={crop.id || crop.name} style={styles.cropListItem}>
                    <View style={styles.cropListInfo}>
                      <Text style={styles.cropListName}>
                        {crop.name || crop.crop}
                      </Text>
                      <Text style={styles.cropListMeta}>
                        {[crop.category, crop.unit].filter(Boolean).join(' • ') ||
                          'No category'}
                      </Text>
                      <View style={styles.cropStats}>
                        <Text style={styles.cropStatText}>
                          Yield/acre: {formatNumber(crop.yield_per_acre)}
                        </Text>
                        <Text style={styles.cropStatText}>
                          Price/unit: {formatNumber(crop.price_per_unit_0)}
                        </Text>
                        <Text style={styles.cropStatText}>
                          Cost/acre: {formatNumber(crop.cost_per_acre)}
                        </Text>
                        <Text style={styles.cropStatText}>
                          Escalation: {formatNumber(crop.escalation_rate)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.cropListActions}>
                      <Pressable
                        style={styles.textBtn}
                        onPress={() => startEditCrop(crop)}
                      >
                        <Text style={styles.textBtnText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        style={styles.textBtn}
                        onPress={() => confirmDeleteCrop(crop)}
                        disabled={cropEditorSaving}
                      >
                        <Text style={[styles.textBtnText, styles.danger]}>
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
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },
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
  subLabel: { fontSize: 14, color: COLORS.textLight, marginBottom: 6 },
  inputGroup: { marginBottom: 16 },
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
  actions: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 4 },
  saveBtn: {
    flex: 1,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  saveBtnText: { color: COLORS.buttonText, fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  emptyText: {
    paddingVertical: 10,
    fontSize: 13,
    color: COLORS.textLight,
  },
  cropList: { marginTop: 8, gap: 8 },
  cropListItem: {
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
  cropListInfo: { flex: 1, paddingRight: 8 },
  cropListName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  cropListMeta: { fontSize: 13, color: COLORS.textLight, marginTop: 2 },
  cropStats: { marginTop: 6, gap: 2 },
  cropStatText: { fontSize: 13, color: COLORS.text },
  cropListActions: { flexDirection: 'row', gap: 8 },
  textBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  textBtnText: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },
  danger: { color: '#C54B4B' },
});

export default CropEditorModal;
