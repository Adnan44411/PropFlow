import type { MigrationFn } from 'umzug';
import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

export const up: MigrationFn<QueryInterface> = async ({ context: queryInterface }) => {
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('property_notes')) {
    await queryInterface.createTable('property_notes', {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },

      property_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      author_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    await queryInterface.addIndex('property_notes', ['property_id', 'id'], {
      name: 'idx_property_notes_property_id',
    });
  }
};

export const down: MigrationFn<QueryInterface> = async ({ context: queryInterface }) => {
  const tables = await queryInterface.showAllTables();

  if (tables.includes('property_notes')) {
    await queryInterface.dropTable('property_notes');
  }
};
