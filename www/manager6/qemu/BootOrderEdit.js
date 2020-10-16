Ext.define('pve-boot-order-entry', {
    extend: 'Ext.data.Model',
    fields: [
	{name: 'name', type: 'string'},
	{name: 'enabled', type: 'bool'},
	{name: 'desc', type: 'string'},
    ]
});

Ext.define('PVE.qemu.BootOrderPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuBootOrderPanel',

    vmconfig: {}, // store loaded vm config
    store: undefined,

    inUpdate: false,
    controller: {
	xclass: 'Ext.app.ViewController',
    },

    isDisk: function(value) {
	return PVE.Utils.bus_match.test(value);
    },

    isBootdev: function(dev, value) {
	return this.isDisk(dev) ||
	    (/^net\d+/).test(dev) ||
	    (/^hostpci\d+/).test(dev) ||
	    ((/^usb\d+/).test(dev) && !(/spice/).test(value));
    },

    setVMConfig: function(vmconfig) {
	let me = this;
	me.vmconfig = vmconfig;

	me.store.removeAll();

	let boot = PVE.Parser.parsePropertyString(me.vmconfig.boot, "legacy");

	let bootorder = [];
	if (boot.order) {
	    bootorder = boot.order.split(';').map(dev => ({name: dev, enabled: true}));
	} else if (!(/^\s*$/).test(me.vmconfig.boot)) {
	    // legacy style, transform to new bootorder
	    let order = boot.legacy || 'cdn';
	    let bootdisk = me.vmconfig.bootdisk || undefined;

	    // get the first 4 characters (acdn)
	    // ignore the rest (there should never be more than 4)
	    let orderList = order.split('').slice(0,4);

	    // build bootdev list
	    for (let i = 0; i < orderList.length; i++) {
		let list = [];
		if (orderList[i] === 'c') {
		    if (bootdisk !== undefined && me.vmconfig[bootdisk]) {
			list.push(bootdisk);
		    }
		} else if (orderList[i] === 'd') {
		    Ext.Object.each(me.vmconfig, function(key, value) {
			if (me.isDisk(key) && (/media=cdrom/).test(value)) {
			    list.push(key);
			}
		    });
		} else if (orderList[i] === 'n') {
		    Ext.Object.each(me.vmconfig, function(key, value) {
			if ((/^net\d+/).test(key)) {
			    list.push(key);
			}
		    });
		}

		// Object.each iterates in random order, sort alphabetically
		list.sort();
		list.forEach(dev => bootorder.push({name: dev, enabled: true}));
	    }
	}

	// add disabled devices as well
	let disabled = [];
	Ext.Object.each(me.vmconfig, function(key, value) {
	    if (me.isBootdev(key, value) &&
		!Ext.Array.some(bootorder, x => x.name === key))
	    {
		disabled.push(key);
	    }
	});
	disabled.sort();
	disabled.forEach(dev => bootorder.push({name: dev, enabled: false}));

	// add descriptions
	bootorder.forEach(entry => {
	    entry.desc = me.vmconfig[entry.name];
	});

	me.store.insert(0, bootorder);
	me.store.fireEvent("update");
    },

    calculateValue: function() {
	let me = this;
	return me.store.getData().items
	    .filter(x => x.data.enabled)
	    .map(x => x.data.name)
	    .join(';');
    },

    onGetValues: function() {
	let me = this;
	// Note: we allow an empty value, so no 'delete' option
	let val = { order: me.calculateValue() };
	let res = { boot: PVE.Parser.printPropertyString(val) };
	return res;
    },

    items: [
	{
	    xtype: 'grid',
	    reference: 'grid',
	    margin: '0 0 5 0',
	    minHeight: 150,
	    defaults: {
		sortable: false,
		hideable: false,
		draggable: false,
	    },
	    columns: [
		{
		    header: '',
		    renderer: () => "<i class='fa fa-reorder cursor-move'></i>",
		    width: 30,
		},
		{
		    header: '#',
		    width: 30,
		    renderer: (value, metaData, record, rowIndex) => {
			let idx = (rowIndex + 1).toString();
			if (record.get('enabled')) {
			    return idx;
			} else {
			    return "<span class='faded'>" + idx + "</span>";
			}
		    },
		},
		{
		    xtype: 'checkcolumn',
		    header: gettext('Enabled'),
		    dataIndex: 'enabled',
		    width: 70,
		},
		{
		    header: gettext('Device'),
		    dataIndex: 'name',
		    width: 70,
		},
		{
		    header: gettext('Description'),
		    dataIndex: 'desc',
		    flex: true,
		},
	    ],
	    viewConfig: {
		plugins: {
		    ptype: 'gridviewdragdrop',
		    dragText: gettext('Drag and drop to reorder'),
		}
	    },
	    listeners: {
		drop: function() {
		    // doesn't fire automatically on reorder
		    this.getStore().fireEvent("update");
		}
	    },
	},
	{
	    xtype: 'component',
	    html: gettext('Drag and drop to reorder'),
	},
	{
	    xtype: 'displayfield',
	    reference: 'emptyWarning',
	    userCls: 'pmx-hint',
	    value: gettext('Warning: No devices selected, the VM will probably not boot!'),
	},
	{
	    // for dirty marking and 'reset' function
	    xtype: 'field',
	    reference: 'marker',
	    hidden: true,
	    setValue: function(val) {
		let me = this;
		let panel = me.up('pveQemuBootOrderPanel');

		// on form reset, go back to original state
		if (!panel.inUpdate) {
		    panel.setVMConfig(panel.vmconfig);
		}

		// not a subclass, so no callParent; just do it manually
		me.setRawValue(me.valueToRaw(val));
		return me.mixins.field.setValue.call(me, val);
	    }
	},
    ],

    initComponent: function() {
	let me = this;

	me.callParent();

	let controller = me.getController();

	let grid = controller.lookup('grid');
	let marker = controller.lookup('marker');
	let emptyWarning = controller.lookup('emptyWarning');

	marker.originalValue = undefined;

	me.store = Ext.create('Ext.data.Store', {
	    model: 'pve-boot-order-entry',
	    listeners: {
		update: function() {
		    this.commitChanges();
		    let val = me.calculateValue();
		    if (marker.originalValue === undefined) {
			marker.originalValue = val;
		    }
		    me.inUpdate = true;
		    marker.setValue(val);
		    me.inUpdate = false;
		    marker.checkDirty();
		    emptyWarning.setHidden(val !== '');
		    grid.getView().refresh();
		}
	    }
	});
	grid.setStore(me.store);
    }
});

Ext.define('PVE.qemu.BootOrderEdit', {
    extend: 'Proxmox.window.Edit',

    items: [{
	xtype: 'pveQemuBootOrderPanel',
	itemId: 'inputpanel'
    }],

    subject: gettext('Boot Order'),
    width: 600,

    initComponent : function() {
	let me = this;
	me.callParent();
	me.load({
	    success: function(response, options) {
		me.down('#inputpanel').setVMConfig(response.result.data);
	    }
	});
    }
});
