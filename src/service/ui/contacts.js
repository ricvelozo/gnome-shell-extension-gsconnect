'use strict';

const Gdk = imports.gi.Gdk;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;


/**
 * Return a random color
 *
 * @param {*} [salt] - If not %null, will be used as salt for generating a color
 * @param {Number} alpha - A value in the [0...1] range for the alpha channel
 * @return {Gdk.RGBA} - A new Gdk.RGBA object generated from the input
 */
function randomRGBA(salt = null, alpha = 1.0) {
    let red, green, blue;

    if (salt !== null) {
        let hash = new GLib.Variant('s', `${salt}`).hash();
        red = ((hash & 0xFF0000) >> 16) / 255;
        green = ((hash & 0x00FF00) >> 8) / 255;
        blue = (hash & 0x0000FF) / 255;
    } else {
        red = Math.random();
        green = Math.random();
        blue = Math.random();
    }

    return new Gdk.RGBA({red: red, green: green, blue: blue, alpha: alpha});
}


/**
 * Get the relative luminance of a RGB set
 * See: https://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef
 *
 * @param {Number} r - A number in the [0.0, 1.0] range for the red value
 * @param {Number} g - A number in the [0.0, 1.0] range for the green value
 * @param {Number} b - A number in the [0.0, 1.0] range for the blue value
 * @return {Number} - ...
 */
function relativeLuminance(rgba) {
    let {red, green, blue} = rgba;

    let R = (red > 0.03928) ? red / 12.92 : Math.pow(((red + 0.055) / 1.055), 2.4);
    let G = (green > 0.03928) ? green / 12.92 : Math.pow(((green + 0.055) / 1.055), 2.4);
    let B = (blue > 0.03928) ? blue / 12.92 : Math.pow(((blue + 0.055) / 1.055), 2.4);

    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}


/**
 * Get a Gdk.RGBA contrasted for the input
 * See: https://www.w3.org/TR/2008/REC-WCAG20-20081211/#contrast-ratiodef
 *
 * @param {Gdk.RGBA} - A Gdk.RGBA object for the background color
 * @return {Gdk.RGBA} - A Gdk.RGBA object for the foreground color
 */
function getFgRGBA(rgba) {
    let bgLuminance = this.relativeLuminance(rgba);
    let lightContrast = (0.07275541795665634 + 0.05) / (bgLuminance + 0.05);
    let darkContrast = (bgLuminance + 0.05) / (0.0046439628482972135 + 0.05);

    let value = (darkContrast > lightContrast) ? 0.06 : 0.94;
    return new Gdk.RGBA({red: value, green: value, blue: value, alpha: 0.5});
}


/**
 * Get Gdk.Pixbuf for @path, allowing the corrupt JPEG's KDE Connect sometimes
 * sends. This function is synchronous
 *
 * @param {string} path - A local file path
 */
function getPixbuf(path, size = null) {
    let data, loader;

    // Catch missing avatar files
    try {
        data = GLib.file_get_contents(path)[1];
    } catch (e) {
        logWarning(e.message, path);
        return undefined;
    }

    // Consider errors from partially corrupt JPEGs to be warnings
    try {
        loader = new GdkPixbuf.PixbufLoader();
        loader.write(data);
        loader.close();
    } catch (e) {
        logWarning(e, path);
    }

    let pixbuf = loader.get_pixbuf();

    // Scale if requested
    if (size !== null) {
        return pixbuf.scale_simple(size, size, GdkPixbuf.InterpType.HYPER);
    } else {
        return pixbuf;
    }
}


/**
 * Return a localized string for a phone number and type
 * See: http://www.ietf.org/rfc/rfc2426.txt
 *
 * @param {string} number - A phone number and RFC2426 phone number type
 * @return {string} - A string like '555-5555・Mobile'
 */
function getNumberLabel(number) {
    if (!number.type) return _('%s・Other').format(number.value);

    switch (true) {
        case number.type.includes('fax'):
            // TRANSLATORS: A fax number
            return _('%s・Fax').format(number.value);

        case number.type.includes('work'):
            // TRANSLATORS: A work phone number
            return _('%s・Work'.format(number.value));

        case number.type.includes('cell'):
            // TRANSLATORS: A mobile or cellular phone number
            return _('%s・Mobile').format(number.value);

        case number.type.includes('home'):
            // TRANSLATORS: A home phone number
            return _('%s・Home').format(number.value);

        default:
            // TRANSLATORS: All other phone number types
            return _('%s・Other').format(number.value);
    }
}


/**
 * Contact Avatar
 */
var Avatar = GObject.registerClass({
    GTypeName: 'GSConnectContactAvatar'
}, class Avatar extends Gtk.DrawingArea {

    _init(contact) {
        super._init({
            height_request: 32,
            width_request: 32,
            visible: true,
            tooltip_text: contact.name || _('Unknown Contact')
        });

        this._path = contact.avatar;
    }

    _loadPixbuf() {
        if (this._path) {
            this._pixbuf = getPixbuf(this._path, 32);
        }

        if (this._pixbuf === undefined) {
            this._fallback = true;

            this.bg_color = randomRGBA(this.tooltip_text);

            let info = Gtk.IconTheme.get_default().lookup_icon(
                'avatar-default',
                24,
                Gtk.IconLookupFlags.FORCE_SYMBOLIC
            );

            this._pixbuf = info.load_symbolic(
                getFgRGBA(this.bg_color),
                null,
                null,
                null
            )[0];
        }

        this._offset = (this.width_request - this._pixbuf.width) / 2;
    }

    vfunc_draw(cr) {
        if (this._pixbuf === undefined) {
            this._loadPixbuf();
        }

        // Clip to a circle
        cr.arc(16, 16, 16, 0, 2 * Math.PI);
        cr.clipPreserve();

        // Fill the background if we don't have an avatar
        if (this._fallback) {
            Gdk.cairo_set_source_rgba(cr, this.bg_color);
            cr.fill();
        }

        // Draw the avatar/icon
        Gdk.cairo_set_source_pixbuf(cr, this._pixbuf, this._offset, this._offset);
        cr.paint();

        cr.$dispose();
        return Gdk.EVENT_PROPAGATE;
    }
});


var ContactChooser = GObject.registerClass({
    GTypeName: 'GSConnectContactChooser',
    Properties: {
        'store': GObject.ParamSpec.object(
            'store',
            'Store',
            'The contacts store',
            GObject.ParamFlags.READWRITE,
            GObject.Object
        )
    },
    Signals: {
        'number-selected': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        }
    },
    Template: 'resource:///org/gnome/Shell/Extensions/GSConnect/contacts.ui',
    Children: ['contact-entry', 'contact-list', 'contact-window']
}, class ContactChooser extends Gtk.Grid {

    _init(params) {
        this.connect_template();
        super._init(params);

        this._contactsChangedId = this.store.connect(
            'notify::contacts',
            this._populate.bind(this)
        );

        // Cleanup on ::destroy
        this.connect('destroy', this._onDestroy);

        this._temporary = undefined;
        this.contact_list._entry = this.contact_entry.text;
        this.contact_list.set_filter_func(this._filter);
        this.contact_list.set_sort_func(this._sort);

        // Placeholder
        let box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        box.get_style_context().add_class('contact-placeholder');
        this.contact_list.set_placeholder(box);

        let image = new Gtk.Image({
            icon_name: 'avatar-default-symbolic',
            pixel_size: 144,
            valign: Gtk.Align.END,
            vexpand: true
        });
        image.get_style_context().add_class('dim-label');
        box.add(image);

        let label = new Gtk.Label({
            label: _('Select a contact or number'),
            justify: Gtk.Justification.CENTER,
            use_markup: true,
            valign: Gtk.Align.START,
            vexpand: true,
            wrap: true
        });
        label.get_style_context().add_class('dim-label');
        box.add(label);
        box.show_all();

        // Populate and setup
        this._populate();
    }

    get selected () {
        let selected = new Set();
        this.contact_list.foreach(row => {
            row.selected.map(number => selected.add(number));
        });
        return Array.from(selected);
    }

    _onDestroy(chooser) {
        chooser.store.disconnect(chooser._contactsChangedId);
        chooser.disconnect_template();
    }

    _onEntryChanged(entry) {
        this.contact_list._entry = entry.text;

        // If the entry contains string with 2 or more digits...
        if (entry.text.replace(/\D/g, '').length >= 2) {
            // ...ensure we have a temporary contact for it
            if (this._temporary === undefined) {
                this._temporary = this.add_contact({
                    // TRANSLATORS: A phone number (eg. "Send to 555-5555")
                    name: _('Send to %s').format(this.contact_entry.text),
                    numbers: [{type: 'unknown', value: this.contact_entry.text}]
                });
                this._temporary.__manual = true;

            // ...or if we already do, then update it
            } else {
                // Update contact object
                this._temporary.contact.name = this.contact_entry.text;
                this._temporary.contact.numbers[0].value = this.contact_entry.text;

                // Update UI
                let grid = this._temporary.get_child();
                let nameLabel = grid.get_child_at(1, 0);
                nameLabel.label = _('Send to %s').format(this.contact_entry.text);
                let numLabel = grid.get_child_at(1, 1);
                numLabel.label = getNumberLabel(this._temporary.contact.numbers[0]);
            }

        // ...otherwise remove any temporary contact that's been created
        } else if (this._temporary) {
            this._temporary.destroy();
            this._temporary = undefined;
        }

        this.contact_list.invalidate_filter();
        this.contact_list.invalidate_sort();
    }

    _onNumberSelected(list, row) {
        this.contact_entry.text = '';
        this.contact_list.select_row(null);
        this.contact_window.vadjustment.value = 0;

        let address = row.number.value;
        this.emit('number-selected', address);
    }

    _filter(row) {
        // Dynamic contact always shown
        if (row.__manual) return true;

        let query = row.get_parent()._entry;
        let queryName = query.toLocaleLowerCase();
        let queryNumber = query.toPhoneNumber();

        // Show contact if text is substring of name
        if (row.contact.name.toLocaleLowerCase().includes(queryName)) {
            return true;

        // Show contact if text is substring of number
        } else if (queryNumber.length) {
            for (let number of row.contact.numbers) {
                if (number.value.toPhoneNumber().includes(queryNumber)) {
                    return true;
                }
            }
        }

        return false;
    }

    _sort(row1, row2) {
        if (row1.__manual) {
            return -1;
        } else if (row2.__manual) {
            return 1;
        }

        return row1.contact.name.localeCompare(row2.contact.name);
    }

    _populate() {
        this.contact_list.foreach(row => row.destroy());

        for (let contact of this.store) {
            this.add_contact(contact);
        }
    }

    add_contact(contact) {
        if (contact.numbers.length === 1) {
            return this.add_contact_number(contact, 0);
        }

        for (let i = 0; i < contact.numbers.length; i++) {
            this.add_contact_number(contact, i);
        }
    }

    add_contact_number(contact, index) {
        let row = new Gtk.ListBoxRow({
            activatable: true,
            selectable: true
        });
        row.contact = contact;
        row.number = contact.numbers[index];
        this.contact_list.add(row);

        let grid = new Gtk.Grid({
            margin: 6,
            column_spacing: 6
        });
        row.add(grid);

        if (index === 0) {
            let avatar = new Avatar(contact);
            avatar.valign = Gtk.Align.CENTER;
            grid.attach(avatar, 0, 0, 1, 2);

            let nameLabel = new Gtk.Label({
                label: contact.name || _('Unknown Contact'),
                halign: Gtk.Align.START,
                hexpand: true,
                visible: true
            });
            grid.attach(nameLabel, 1, 0, 1, 1);
        }

        let numLabel = new Gtk.Label({
            label: getNumberLabel(row.number),
            halign: Gtk.Align.START,
            hexpand: true,
            margin_start: (index > 0) ? 38 : 0,
            visible: true
        });
        numLabel.get_style_context().add_class('dim-label');
        grid.attach(numLabel, 1, 1, 1, 1);

        row.show_all();
        return row;
    }

    /**
     * Reset the selected contacts and re-populate the list
     */
    reset() {
        this.contact_list.foreach(row => {
            row.numbers.map(number => {
                number.selected = false;
            });
        });
    }
});

