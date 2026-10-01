import { DataTypes, QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const columns = await qi.describeTable('property_notes');

  if (!columns.tenant_id) {
    await qi.addColumn('property_notes', 'tenant_id', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
  }

  // Align property_id with properties.id
  if (columns.property_id) {
    await qi.changeColumn('property_notes', 'property_id', {
      type: DataTypes.BIGINT,
      allowNull: false,
    });
  }
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  const columns = await qi.describeTable('property_notes');

  if (columns.tenant_id) {
    await qi.removeColumn('property_notes', 'tenant_id');
  }
};
