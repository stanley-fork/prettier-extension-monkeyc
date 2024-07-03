class Base {
    function initialize() {
        f1();
        f2();
        Base.f2();
    }

    function f1() as Void {}

    function f2() as Void {}
}

class Derived extends Base {
    function initialize() {
        Base.initialize();
    }

    function use_f2() {
        f2();
    }

    function f2() as Void {}
}
