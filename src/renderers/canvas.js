/**
 * A simple canvas renderer.
 * Renders circles and convex-polygons
 * @module renderers/canvas
 */
Physics.renderer('canvas', function( proto ){

    if ( !document ){
        // must be in node environment
        return {};
    }

    var Pi2 = Math.PI * 2
        // helper to create new dom elements
        ,newEl = function( node, content ){
            var el = document.createElement(node || 'div');
            if (content){
                el.innerHTML = content;
            }
            return el;
        }
        ,colors = {
            white: '#fff'
            ,violet: '#542437'
            ,blue: '#53777A'
            ,gold: '#ECD078'
            ,orange: '#D95B43'
            ,pink: '#C02942'
        }
        ;

    var defaults = {

        // draw aabbs of bodies for debugging
        debug: false,
        // the element to place meta data into
        metaEl: null,
        // default styles of drawn objects
        styles: {

            'circle' : {
                strokeStyle: colors.blue,
                lineWidth: 1,
                fillStyle: colors.blue,
                angleIndicator: colors.white
            },

            'convex-polygon' : {
                strokeStyle: colors.violet,
                lineWidth: 1,
                fillStyle: colors.violet,
                angleIndicator: colors.white
            }
        },
        offset: { x: 0, y: 0 }
    };

    // deep copy callback to extend deeper into options
    var deep = function( a, b ){

        if ( Physics.util.isPlainObject( b ) ){

            return Physics.util.extend({}, a, b, deep );
        }

        return b !== undefined ? b : a;
    };

    return {

        /**
         * Initialization
         * @param  {Object} options Config options passed by initializer
         * @return {void}
         */
        init: function( options ){

            var self = this;

            // call proto init
            proto.init.call(this, options);

            // further options
            this.options = Physics.util.extend({}, defaults, this.options, deep);
            this.options.offset = Physics.vector( this.options.offset );


            // hidden canvas
            this.hiddenCanvas = document.createElement('canvas');
            this.hiddenCanvas.width = this.hiddenCanvas.height = 100;

            if (!this.hiddenCanvas.getContext){
                throw "Canvas not supported";
            }

            this.hiddenCtx = this.hiddenCanvas.getContext('2d');

            // actual viewport
            var viewport = this.el;
            if (viewport.nodeName.toUpperCase() !== 'CANVAS'){

                viewport = document.createElement('canvas');
                this.el.appendChild( viewport );
                if (typeof this.options.el === 'string' && this.el === document.body){
                    viewport.id = this.options.el;
                }
                this.el = viewport;
            }

            this.ctx = viewport.getContext('2d');

            this.els = {};

            if (this.options.meta){
                var stats = this.options.metaEl || newEl();
                stats.className = 'pjs-meta';
                this.els.fps = newEl('span');
                this.els.ipf = newEl('span');
                stats.appendChild(newEl('span', 'fps: '));
                stats.appendChild(this.els.fps);
                stats.appendChild(newEl('br'));
                stats.appendChild(newEl('span', 'ipf: '));
                stats.appendChild(this.els.ipf);

                viewport.parentNode.insertBefore(stats, viewport);
            }

            this._layers = {};
            this.addLayer( 'main', this.el );
            this.resize( this.options.width, this.options.height );
        },

        layer: function( name ){

            if ( name in this._layers ){
                return this._layers[ name ];
            }

            return null;
        },

        addLayer: function( id, el, opts ){

            var self = this
                ,bodies = []
                ,styles = Physics.util.extend({}, this.options.styles)
                ,layer = {
                    id: id
                    ,el: el || document.createElement('canvas')
                    ,options: Physics.util.options({
                        width: this.el.width
                        ,height: this.el.height
                        ,manual: false
                        ,autoResize: true
                        ,follow: null
                        ,scale: 1
                        ,zIndex: 1
                    })( opts )
                }
                ;

            if ( id in this._layers ){
                throw 'Layer "' + id + '" already added.';
            }

            this.el.parentNode.insertBefore( layer.el, this.el );
            layer.el.style.position = 'absolute';
            layer.el.style.zIndex = layer.options.zIndex;
            layer.el.className += ' pjs-layer-' + layer.id;
            layer.ctx = layer.el.getContext('2d');
            layer.ctx.scale( 1, 1 );
            layer.el.width = layer.options.width;
            layer.el.height = layer.options.height;

            layer.bodies = bodies;

            layer.reset = function( arr ){

                bodies = arr || [];
            };

            layer.addToStack = function( thing ){

                if ( Physics.util.isArray( thing ) ){
                    bodies.push.apply( bodies, thing );
                } else {
                    bodies.push( thing );
                }
                return layer;
            };

            layer.removeFromStack = function( thing ){

                var i, l;

                if ( Physics.util.isArray( thing ) ){
                    for ( i = 0, l = thing.length; i < l; ++i ){
                        layer.removeFromStack(thing[ i ]);
                    }
                } else {
                    i = Physics.util.indexOf( bodies, thing );
                    if ( i > -1 ){
                        bodies.splice( i, 1 );
                    }
                }
                return layer;
            };

            layer.render = function( clear ){

                var body
                    ,scratch = Physics.scratchpad()
                    ,offset = scratch.vector().set(0, 0)
                    ,scale = layer.options.scale
                    ,view
                    ,i
                    ,l = bodies.length
                    ,stack = l ? bodies : self._world._bodies
                    ;

                if ( layer.options.manual ){
                    scratch.done();
                    return layer;
                }

                if ( layer.options.offset ){
                    if ( layer.options.offset === 'center' ){
                        offset.add( layer.el.width * 0.5, layer.el.height * 0.5 ).mult( 1/scale );
                    } else {
                        offset.vadd( layer.options.offset ).mult( 1/scale );
                    }
                }

                if ( layer.options.follow ){
                    offset.vsub( layer.options.follow.state.pos );
                }

                if ( clear !== false ){
                    layer.ctx.clearRect(0, 0, layer.el.width, layer.el.height);
                }

                if ( scale !== 1 ){
                    layer.ctx.save();
                    layer.ctx.scale( scale, scale );
                }

                for ( i = 0, l = stack.length; i < l; ++i ){

                    body = stack[ i ];
                    if ( !body.hidden ){
                        view = body.view || ( body.view = self.createView(body.geometry, body.styles || styles[ body.geometry.name ]) );
                        self.drawBody( body, body.view, layer.ctx, offset );
                    }
                }

                if ( scale !== 1 ){
                    layer.ctx.restore();
                }

                scratch.done();
                return layer;
            };

            // remember layer
            this._layers[ id ] = layer;

            return layer;
        },

        removeLayer: function( idOrLayer ){

            var id = idOrLayer.id ? idOrLayer.id : idOrLayer
                ,el = this._layers[ id ].el
                ;

            if ( el !== this.el ){
                el.parentNode.removeChild( el );
            }
            delete this._layers[ id ];
            return this;
        },

        resize: function( width, height ){

            var layer;

            for ( var id in this._layers ){

                layer = this._layers[ id ];
                if ( layer.options.autoResize ){
                    layer.el.width = width;
                    layer.el.height = height;
                }
            }
        },

        /**
         * Set the styles of specified context
         * @param {Object|String} styles Styles configuration for body drawing
         * @param {Canvas2DContext} ctx    (optional) Defaults to visible canvas context
         */
        setStyle: function( styles, ctx ){

            ctx = ctx || this.ctx;

            if ( Physics.util.isObject(styles) ){

                styles.strokeStyle = styles.lineWidth ? styles.strokeStyle : 'rgba(0,0,0,0)';
                Physics.util.extend(ctx, styles);

            } else {

                ctx.fillStyle = ctx.strokeStyle = styles;
                ctx.lineWidth = 1;
            }
        },

        /**
         * Draw a circle to specified canvas context
         * @param  {Number} x      The x coord
         * @param  {Number} y      The y coord
         * @param  {Number} r      The circle radius
         * @param  {Object|String} styles The styles configuration
         * @param  {Canvas2DContext} ctx    (optional) The canvas context
         * @return {void}
         */
        drawCircle: function(x, y, r, styles, ctx){

            ctx = ctx || this.ctx;

            ctx.beginPath();
            this.setStyle( styles, ctx );
            ctx.arc(x, y, r, 0, Pi2, false);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
        },

        /**
         * Draw a polygon to specified canvas context
         * @param  {Array} verts  Array of vectorish vertices
         * @param  {Object|String} styles The styles configuration
         * @param  {Canvas2DContext} ctx    (optional) The canvas context
         * @return {void}
         */
        drawPolygon: function(verts, styles, ctx){

            var vert = verts[0]
                ,x = vert.x
                ,y = vert.y
                ,l = verts.length
                ;

            ctx = ctx || this.ctx;
            ctx.beginPath();
            this.setStyle( styles, ctx );

            ctx.moveTo(x, y);

            for ( var i = 1; i < l; ++i ){

                vert = verts[ i ];
                x = vert.x;
                y = vert.y;
                ctx.lineTo(x, y);
            }

            if ( l > 2 ){
                ctx.closePath();
            }

            ctx.stroke();
            ctx.fill();
        },

        /**
         * Draw a rectangle to specified canvas context
         * @param  {Number} x      The x coord
         * @param  {Number} y      The y coord
         * @param  {Number} width  Width of the rectangle
         * @param  {Number} height Height of the rectangle
         * @param  {Object|String} styles The styles configuration
         * @param  {Canvas2DContext} ctx    (optional) The canvas context
         * @return {void}
         */
        drawRect: function(x, y, width, height, styles, ctx){

            var hw = width * 0.5
                ,hh = height * 0.5
                ;

            ctx = ctx || this.ctx;
            this.setStyle( styles, ctx );
            ctx.beginPath();
            ctx.rect(x - hw, y - hh, width, height);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
        },

        /**
         * Draw a line onto specified canvas context
         * @param  {Vectorish} from   Starting point
         * @param  {Vectorish} to     Ending point
         * @param  {Object|String} styles The styles configuration
         * @param  {Canvas2DContext} ctx    (optional) The canvas context
         * @return {void}
         */
        drawLine: function(from, to, styles, ctx){

            var x = from.x
                ,y = from.y
                ;

            ctx = ctx || this.ctx;

            ctx.beginPath();
            this.setStyle( styles, ctx );

            ctx.moveTo(x, y);

            x = to.x;
            y = to.y;

            ctx.lineTo(x, y);

            ctx.stroke();
            ctx.fill();
        },

        /**
         * Create a view for specified geometry.
         * @param  {Geometry} geometry The geometry
         * @param  {Object|String} styles The styles configuration
         * @return {Image}          An image cache of the geometry
         */
        createView: function( geometry, styles ){

            var view
                ,aabb = geometry.aabb()
                ,hw = aabb.hw + Math.abs(aabb.x)
                ,hh = aabb.hh + Math.abs(aabb.y)
                ,x = hw + 1
                ,y = hh + 1
                ,hiddenCtx = this.hiddenCtx
                ,hiddenCanvas = this.hiddenCanvas
                ,name = geometry.name
                ;

            styles = styles || this.options.styles[ name ] || {};

            // must want an image
            if ( styles.src ){
                view = new Image();
                view.src = styles.src;
                if ( styles.width ){
                    view.width = styles.width;
                }
                if ( styles.height ){
                    view.height = styles.height;
                }
                return view;
            }

            x += styles.lineWidth | 0;
            y += styles.lineWidth | 0;

            // clear
            hiddenCanvas.width = 2 * hw + 2 + (2 * styles.lineWidth|0);
            hiddenCanvas.height = 2 * hh + 2 + (2 * styles.lineWidth|0);

            hiddenCtx.save();
            hiddenCtx.translate(x, y);

            if (name === 'circle'){

                this.drawCircle(0, 0, geometry.radius, styles, hiddenCtx);

            } else if (name === 'convex-polygon'){

                this.drawPolygon(geometry.vertices, styles, hiddenCtx);
            }

            if (styles.angleIndicator){

                hiddenCtx.beginPath();
                this.setStyle( styles.angleIndicator, hiddenCtx );
                hiddenCtx.moveTo(0, 0);
                hiddenCtx.lineTo(hw, 0);
                hiddenCtx.closePath();
                hiddenCtx.stroke();
            }

            hiddenCtx.restore();

            view = new Image( hiddenCanvas.width, hiddenCanvas.height );
            view.src = hiddenCanvas.toDataURL('image/png');
            return view;
        },

        /**
         * Draw the meta data
         * @param  {Object} meta The meta data
         * @return {void}
         */
        drawMeta: function( meta ){

            this.els.fps.innerHTML = meta.fps.toFixed(2);
            this.els.ipf.innerHTML = meta.ipf;
        },

        /**
         * Draw a body to canvas
         * @param  {Body} body The body to draw
         * @param  {Image} view The view for that body
         * @return {void}
         */
        drawBody: function( body, view, ctx, offset ){

            var pos = body.state.pos
                ,aabb
                ;

            offset = offset || this.options.offset;
            ctx = ctx || this.ctx;

            ctx.save();
            ctx.translate(pos.x + offset.x, pos.y + offset.y);
            ctx.rotate(body.state.angular.pos);
            ctx.drawImage(view, -view.width/2, -view.height/2);
            ctx.restore();

            if ( this.options.debug ){
                aabb = body.aabb();
                // draw bounding boxes
                this.drawRect( aabb.x, aabb.y, 2 * aabb.hw, 2 * aabb.hh, 'rgba(0, 0, 255, 0.3)' );

                // draw also paths
                body._debugView = body._debugView || this.createView(body.geometry, 'rgba(255, 0, 0, 0.5)');
                ctx.save();
                ctx.translate(pos.x + offset.x, pos.y + offset.y);
                ctx.rotate(body.state.angular.pos);
                ctx.drawImage(body._debugView, -body._debugView.width * 0.5, -body._debugView.height * 0.5);
                ctx.restore();
            }
        },

        render: function( bodies, meta ){

            var body
                ,view
                ,pos
                ;

            this._world.emit('beforeRender', {
                renderer: this,
                meta: meta
            });

            if ( this.options.meta ) {
                this.drawMeta( meta );
            }

            for ( var id in this._layers ){

                this._layers[ id ].render();
            }

            return this;
        }
    };
});
