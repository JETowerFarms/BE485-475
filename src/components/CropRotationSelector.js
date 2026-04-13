import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { COLORS } from '../styles/theme';

// Crop rotation selector — pick a farm and assign rotation crops.
const CropRotationSelector = ({
  selectedFarmIds,
  getFarmLabel,
  cropOptions,
  cropOptionsLoading,
  cropOptionsError,
  rotationFarmId,
  onRotationFarmChange,
  rotationDraftCropIds,
  onToggleCrop,
  onNoRotation,
  onOpenCropEditor,
}) => {
  const [rotationFarmDropdownOpen, setRotationFarmDropdownOpen] = useState(false);
  const [rotationDropdownOpen, setRotationDropdownOpen] = useState(false);
  const [rotationSearch, setRotationSearch] = useState('');

  const filteredCropOptions = useMemo(() => {
    const term = rotationSearch.trim().toLowerCase();
    if (!term) return cropOptions;
    return cropOptions.filter((c) => {
      const name = String(c?.name || '').toLowerCase();
      const crop = String(c?.crop || '').toLowerCase();
      const category = String(c?.category || '').toLowerCase();
      return name.includes(term) || crop.includes(term) || category.includes(term);
    });
  }, [cropOptions, rotationSearch]);

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>Select Rotation</Text>

      <View style={styles.selectorCard}>
        <Text style={styles.subLabel}>Choose farm</Text>
        <Pressable
          style={[
            styles.dropdownButton,
            selectedFarmIds.length === 0 && styles.dropdownButtonDisabled,
          ]}
          onPress={() => {
            if (selectedFarmIds.length === 0) return;
            setRotationFarmDropdownOpen(!rotationFarmDropdownOpen);
          }}
        >
          <Text style={styles.dropdownButtonText}>
            {rotationFarmId ? getFarmLabel(rotationFarmId) : 'Select a farm...'}
          </Text>
          <Text style={styles.dropdownArrow}>
            {rotationFarmDropdownOpen ? '^' : 'v'}
          </Text>
        </Pressable>

        {rotationFarmDropdownOpen && (
          <ScrollView style={styles.dropdownList} nestedScrollEnabled>
            {selectedFarmIds.map((farmId) => (
              <Pressable
                key={farmId}
                style={styles.dropdownItem}
                onPress={() => {
                  onRotationFarmChange(farmId);
                  setRotationFarmDropdownOpen(false);
                  setRotationDropdownOpen(false);
                  setRotationSearch('');
                }}
              >
                <View style={styles.checkbox}>
                  {rotationFarmId === farmId && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.dropdownItemText}>{getFarmLabel(farmId)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.selectorCard}>
        <Text style={styles.subLabel}>Rotation crops (optional)</Text>
        <Pressable
          style={[
            styles.dropdownButton,
            !rotationFarmId && styles.dropdownButtonDisabled,
          ]}
          onPress={() => {
            if (!rotationFarmId) return;
            setRotationDropdownOpen(!rotationDropdownOpen);
          }}
        >
          <Text style={styles.dropdownButtonText}>
            {!rotationFarmId
              ? 'Select a farm first...'
              : rotationDraftCropIds.length === 0
                ? 'No rotation'
                : `${rotationDraftCropIds.length} crop${
                    rotationDraftCropIds.length > 1 ? 's' : ''
                  } selected`}
          </Text>
          <Text style={styles.dropdownArrow}>
            {rotationDropdownOpen ? '^' : 'v'}
          </Text>
        </Pressable>

        {rotationDropdownOpen && (
          <View style={styles.dropdownList}>
            <TextInput
              style={styles.dropdownSearchInput}
              value={rotationSearch}
              onChangeText={setRotationSearch}
              placeholder="Search crops..."
              placeholderTextColor={COLORS.placeholder}
            />

            <Pressable style={styles.dropdownItem} onPress={onNoRotation}>
              <View style={styles.checkbox}>
                {rotationDraftCropIds.length === 0 && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
              <Text style={styles.dropdownItemText}>No rotation</Text>
            </Pressable>

            {cropOptionsLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.accent} />
                <Text style={styles.emptyText}>Loading crops…</Text>
              </View>
            ) : cropOptionsError ? (
              <Text style={styles.emptyText}>{cropOptionsError}</Text>
            ) : filteredCropOptions.length === 0 ? (
              <Text style={styles.emptyText}>No crops found</Text>
            ) : (
              <ScrollView style={styles.dropdownInnerScroll} nestedScrollEnabled>
                {filteredCropOptions.map((crop) => (
                  <Pressable
                    key={crop.id}
                    style={styles.dropdownItem}
                    onPress={() => onToggleCrop(crop.id)}
                  >
                    <View style={styles.checkbox}>
                      {rotationDraftCropIds.includes(crop.id) && (
                        <Text style={styles.checkmark}>✓</Text>
                      )}
                    </View>
                    <Text style={styles.dropdownItemText}>{crop.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>

      <Pressable style={styles.editBtn} onPress={onOpenCropEditor}>
        <Text style={styles.editBtnText}>Edit crop table</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  inputGroup: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  subLabel: { fontSize: 14, color: COLORS.textLight, marginBottom: 6 },
  selectorCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.inputBg,
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
  },
  dropdownButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  dropdownButtonDisabled: { opacity: 0.6 },
  dropdownArrow: { color: COLORS.textLight, fontSize: 14, marginLeft: 8 },
  dropdownList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    maxHeight: 200,
  },
  dropdownInnerScroll: { maxHeight: 180 },
  dropdownSearchInput: {
    backgroundColor: COLORS.inputBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  dropdownItemText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
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
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 3,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
  },
  checkmark: { fontSize: 14, fontWeight: 'bold', color: COLORS.accent },
  editBtn: {
    marginTop: 12,
    backgroundColor: COLORS.buttonBg,
    borderWidth: 1,
    borderColor: COLORS.buttonBorder,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  editBtnText: { color: COLORS.buttonText, fontSize: 14, fontWeight: '700' },
});

export default CropRotationSelector;
